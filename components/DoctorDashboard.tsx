
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, addDoc, serverTimestamp, doc, getDoc, where, updateDoc, deleteDoc, getDocs, arrayUnion, setDoc } from 'firebase/firestore';
import { UserProfile, ConnectionRequest, UserRole } from '../types';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';

interface DoctorDashboardProps {
  user: UserProfile;
  toggleTheme: () => void;
  theme: 'light' | 'dark';
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const decodeAudioData = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};

type ActiveTab = 'reports' | 'requests' | 'patients' | 'profile' | 'clinics';

export const DoctorDashboard: React.FC<DoctorDashboardProps> = ({ user, toggleTheme, theme }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('reports');
  const [reports, setReports] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ConnectionRequest[]>([]);
  const [connectedPatients, setConnectedPatients] = useState<ConnectionRequest[]>([]);
  const [allClinics, setAllClinics] = useState<UserProfile[]>([]);
  const [myClinicConnections, setMyClinicConnections] = useState<ConnectionRequest[]>([]);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [patientProfile, setPatientProfile] = useState<any>(null);
  
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactMode, setContactMode] = useState<'message' | 'call'>('message');
  const [messageDraft, setMessageDraft] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [transcription, setTranscription] = useState('');

  // Profile Form State
  const [profileForm, setProfileForm] = useState({
    education: user.education || '',
    specialization: user.specialization || '',
    experience: user.experience || 0,
    hospital: user.hospital || '',
    smallClinics: user.smallClinics?.join(', ') || ''
  });

  // History State
  const [historyTarget, setHistoryTarget] = useState<any>(null);
  const [historyReports, setHistoryReports] = useState<any[]>([]);
  const [historyAdvice, setHistoryAdvice] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const audioContextRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const unreadReportsCount = reports.filter(r => !r.readBy?.includes(user.uid)).length;

  useEffect(() => {
    const qReports = query(
      collection(db, 'reports'), 
      where('sharedWith', 'array-contains', user.uid)
    );
    const unsubscribeReports = onSnapshot(qReports, (snapshot) => {
      const reportData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setReports(reportData.sort((a: any, b: any) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
      setLoading(false);
    });

    const qRequests = query(
      collection(db, 'connection_requests'), 
      where('toId', '==', user.uid),
      where('status', '==', 'PENDING')
    );
    const unsubscribeRequests = onSnapshot(qRequests, (snapshot) => {
      setPendingRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ConnectionRequest)));
    });

    const qConnections = query(
      collection(db, 'connection_requests'), 
      where('toId', '==', user.uid),
      where('status', '==', 'ACCEPTED')
    );
    const unsubscribeConnections = onSnapshot(qConnections, (snapshot) => {
      setConnectedPatients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ConnectionRequest)));
    });

    // Fetch clinics logic
    const fetchClinics = async () => {
      const q = query(collection(db, 'users'), where('role', '==', UserRole.CLINIC));
      const snap = await getDocs(q);
      setAllClinics(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    };
    fetchClinics();

    // Monitor my clinic connection requests
    const qClinicReqs = query(collection(db, 'connection_requests'), where('fromId', '==', user.uid), where('toRole', '==', UserRole.CLINIC));
    const unsubscribeClinicReqs = onSnapshot(qClinicReqs, (snapshot) => {
      setMyClinicConnections(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ConnectionRequest)));
    });

    return () => {
      unsubscribeReports();
      unsubscribeRequests();
      unsubscribeConnections();
      unsubscribeClinicReqs();
    };
  }, [user.uid]);

  useEffect(() => {
    if (selectedReport) {
      fetchPatientProfile(selectedReport.patientId);
      markReportAsRead(selectedReport.id);
    }
  }, [selectedReport]);

  const markReportAsRead = async (reportId: string) => {
    try {
      const reportRef = doc(db, 'reports', reportId);
      await updateDoc(reportRef, {
        readBy: arrayUnion(user.uid)
      });
    } catch (err) {
      console.error("Failed to mark report as read:", err);
    }
  };

  const fetchPatientProfile = async (patientId: string) => {
    try {
      const pDoc = await getDoc(doc(db, 'users', patientId));
      if (pDoc.exists()) {
        setPatientProfile(pDoc.data());
      }
    } catch (err) {
      console.error("Error fetching patient profile", err);
    }
  };

  const handleUpdateProfile = async () => {
    setLoading(true);
    try {
      const smallClinicsArr = profileForm.smallClinics.split(',').map(s => s.trim()).filter(s => s !== '');
      await updateDoc(doc(db, 'users', user.uid), {
        education: profileForm.education,
        specialization: profileForm.specialization,
        experience: Number(profileForm.experience),
        hospital: profileForm.hospital,
        smallClinics: smallClinicsArr
      });
      alert('Professional profile updated successfully!');
    } catch (err) {
      console.error("Failed to update profile", err);
      alert('Update failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sendClinicConnectionRequest = async (clinic: UserProfile) => {
    const requestId = `DR_TO_CLINIC_${user.uid}_${clinic.uid}`;
    try {
      await setDoc(doc(db, 'connection_requests', requestId), {
        fromId: user.uid,
        fromName: user.displayName,
        fromRole: user.role,
        toId: clinic.uid,
        toName: clinic.displayName,
        toRole: UserRole.CLINIC,
        status: 'PENDING',
        timestamp: serverTimestamp()
      });
      alert(`Request sent to ${clinic.displayName}!`);
    } catch (err) {
      console.error("Failed to send request", err);
    }
  };

  const getClinicRequest = (clinicId: string) => {
    return myClinicConnections.find(r => r.toId === clinicId);
  };

  const handleOpenHistory = async (patient: any) => {
    setHistoryTarget(patient);
    setLoadingHistory(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const qHReports = query(
        collection(db, 'reports'),
        where('patientId', '==', patient.fromId),
        where('sharedWith', 'array-contains', user.uid)
      );
      const snapHReports = await getDocs(qHReports);
      const allHReports = snapHReports.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const filteredHReports = allHReports.filter((r: any) => {
        const ts = r.timestamp?.seconds ? r.timestamp.seconds * 1000 : 0;
        return ts >= thirtyDaysAgo.getTime();
      }).sort((a: any, b: any) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

      setHistoryReports(filteredHReports);

      const qHAdvice = query(
        collection(db, 'doctorMessages'),
        where('patientId', '==', patient.fromId),
        where('doctorId', '==', user.uid)
      );
      const snapHAdvice = await getDocs(qHAdvice);
      const allHAdvice = snapHAdvice.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      
      setHistoryAdvice(allHAdvice);
    } catch (err) {
      console.error("History fetch failed", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleConnectionAction = async (requestId: string, status: 'ACCEPTED' | 'REJECTED') => {
    try {
      if (status === 'ACCEPTED') {
        await updateDoc(doc(db, 'connection_requests', requestId), { status: 'ACCEPTED' });
      } else {
        await deleteDoc(doc(db, 'connection_requests', requestId));
      }
    } catch (err) {
      console.error("Connection action failed", err);
    }
  };

  const handleSendMessage = async () => {
    if (!messageDraft.trim() || (!selectedReport && !historyTarget)) return;
    setIsSending(true);
    try {
      const targetId = selectedReport ? selectedReport.patientId : historyTarget.fromId;
      const targetName = selectedReport ? selectedReport.patientName : historyTarget.fromName;
      
      await addDoc(collection(db, 'doctorMessages'), {
        doctorId: user.uid,
        doctorName: user.displayName,
        patientId: targetId,
        patientName: targetName,
        content: messageDraft,
        timestamp: serverTimestamp(),
        read: false 
      });

      if (selectedReport) {
        await markReportAsRead(selectedReport.id);
      }

      setMessageDraft('');
      setShowContactModal(false);
      alert('Clinical advice dispatched successfully.');
      if (historyTarget) handleOpenHistory(historyTarget);
    } catch (err) {
      console.error("Failed to send message", err);
    } finally {
      setIsSending(false);
    }
  };

  const handleAIDraft = async () => {
    if (!selectedReport) return;
    setIsDrafting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Draft a clinical response for Dr. ${user.displayName} to patient ${selectedReport.patientName}. 
      Symptoms: ${selectedReport.symptoms}. 
      AI Assessment: ${selectedReport.analysis}.
      Patient Medical Context: Chronic Conditions: ${patientProfile?.medicalProfile?.chronicConditions || 'None'}, Allergies: ${patientProfile?.medicalProfile?.allergies || 'None'}.
      Address the patient professionally.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt
      });
      setMessageDraft(response.text || '');
    } catch (err) {
      console.error("Drafting failed", err);
    } finally {
      setIsDrafting(false);
    }
  };

  const startLiveConsultation = async () => {
    setIsLiveActive(true);
    setTranscription('Initializing secure connection...');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = { input: inputCtx, output: outputCtx };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setTranscription('Live. Medical assistant active.');
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              setTranscription(prev => prev + ' ' + message.serverContent?.outputTranscription?.text);
            }
            const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64EncodedAudioString) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              const buffer = await decodeAudioData(decode(base64EncodedAudioString), outputCtx, 24000, 1);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
            }
          },
          onclose: () => setIsLiveActive(false),
          onerror: () => setIsLiveActive(false)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          systemInstruction: `You are a medical scribe assisting Dr. ${user.displayName}.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      setIsLiveActive(false);
    }
  };

  const stopLiveConsultation = () => {
    if (sessionRef.current) sessionRef.current.close();
    if (audioContextRef.current) {
      audioContextRef.current.input.close();
      audioContextRef.current.output.close();
    }
    setIsLiveActive(false);
  };

  return (
    <div className="flex min-h-[calc(100vh-64px)] bg-white dark:bg-gray-950 transition-colors">
      <aside className="w-[280px] bg-[#f9f9f9] dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-[calc(100vh-64px)] sticky top-16 transition-colors">
        <div className="p-3 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
          <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-2xl shadow-sm mb-4 border border-gray-50 dark:border-gray-700">
             <div className="w-12 h-12 bg-blue-600 dark:bg-blue-800 text-white rounded-2xl flex items-center justify-center font-black">DR</div>
             <div>
               <p className="font-black text-gray-900 dark:text-white leading-none truncate w-32">Dr. {user.displayName}</p>
               <p className="text-[9px] text-blue-500 font-black uppercase tracking-widest mt-1">{user.specialization || 'Consultant'}</p>
             </div>
          </div>
          <div className="space-y-0.5">
            <h4 className="px-3 text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase mb-2 tracking-widest">Workspace</h4>
            <button onClick={() => setActiveTab('reports')} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[14px] transition-all group ${activeTab === 'reports' ? 'bg-gray-100 dark:bg-gray-800 font-black text-gray-900 dark:text-white shadow-sm' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-700 dark:text-gray-400'}`}>
              <div className="flex items-center gap-3">🩺 Patient Reports</div>
              {unreadReportsCount > 0 && <span className="bg-blue-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{unreadReportsCount}</span>}
            </button>
            <button onClick={() => setActiveTab('requests')} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[14px] transition-all group ${activeTab === 'requests' ? 'bg-gray-100 dark:bg-gray-800 font-black text-gray-900 dark:text-white shadow-sm' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-700 dark:text-gray-400'}`}>
              <div className="flex items-center gap-3">📩 New Requests</div>
              {pendingRequests.length > 0 && <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{pendingRequests.length}</span>}
            </button>
            <button onClick={() => setActiveTab('patients')} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[14px] transition-all group ${activeTab === 'patients' ? 'bg-gray-100 dark:bg-gray-800 font-black text-gray-900 dark:text-white shadow-sm' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-700 dark:text-gray-400'}`}>
              <div className="flex items-center gap-3">👥 Connected Patients</div>
              <span className="text-gray-400 font-bold text-[10px]">{connectedPatients.length}</span>
            </button>
          </div>
          <div className="space-y-0.5">
            <h4 className="px-3 text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase mb-2 mt-4 tracking-widest">Profile & Networking</h4>
            <button onClick={() => setActiveTab('profile')} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[14px] transition-all group ${activeTab === 'profile' ? 'bg-gray-100 dark:bg-gray-800 font-black text-gray-900 dark:text-white shadow-sm' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-700 dark:text-gray-400'}`}>
              <div className="flex items-center gap-3">👤 My Profile</div>
            </button>
            <button onClick={() => setActiveTab('clinics')} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[14px] transition-all group ${activeTab === 'clinics' ? 'bg-gray-100 dark:bg-gray-800 font-black text-gray-900 dark:text-white shadow-sm' : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-700 dark:text-gray-400'}`}>
              <div className="flex items-center gap-3">🏥 Clinic Discovery</div>
            </button>
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 transition-colors">
          <button 
            onClick={toggleTheme} 
            className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-900 transition-all text-sm font-bold text-gray-700 dark:text-gray-300 shadow-sm"
          >
            <span className="text-lg">{theme === 'light' ? '🌙' : '☀️'}</span>
            <span>{theme === 'light' ? 'Dark' : 'Light'} Mode</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-white dark:bg-gray-950 transition-colors">
        <div className="max-w-6xl mx-auto px-8 py-12">
          {activeTab === 'reports' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fade-in">
              <div className="lg:col-span-4 space-y-4">
                <h3 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight mb-8">Clinical Files</h3>
                <div className="space-y-3">
                  {reports.length === 0 ? <p className="text-gray-400 dark:text-gray-500 font-bold italic">No shared reports available.</p> : reports.map((report) => (
                    <button key={report.id} onClick={() => setSelectedReport(report)} className={`w-full text-left p-5 rounded-[28px] border transition-all relative flex flex-col justify-center ${selectedReport?.id === report.id ? 'bg-blue-600 border-blue-600 shadow-xl text-white' : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 text-gray-800 dark:text-gray-200 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-lg'}`}>
                      <div className="flex items-center justify-between">
                        <p className="font-black text-lg truncate w-10/12">{report.patientName}</p>
                        {(!report.readBy || !report.readBy.includes(user.uid)) && (
                          <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]"></span>
                        )}
                      </div>
                      <p className={`text-[10px] mt-1 font-black uppercase tracking-widest ${selectedReport?.id === report.id ? 'text-blue-100' : 'text-gray-400 dark:text-gray-500'}`}>Priority: {report.urgency}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-8">
                {selectedReport ? (
                  <div className="bg-white dark:bg-gray-900 rounded-[40px] shadow-2xl border border-gray-100 dark:border-gray-800 p-10 animate-fade-in-up space-y-8">
                    <div className="flex justify-between items-start border-b border-gray-50 dark:border-gray-800 pb-8">
                      <div>
                        <h3 className="text-3xl font-black text-gray-900 dark:text-white">{selectedReport.patientName}</h3>
                        <p className="text-[10px] font-black text-gray-400 uppercase mt-1 tracking-widest">{new Date(selectedReport.timestamp?.seconds * 1000).toLocaleString()}</p>
                      </div>
                      <span className={`px-6 py-2 rounded-2xl font-black text-xs uppercase ${selectedReport.urgency === 'Critical' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>{selectedReport.urgency}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Medical Context</h4>
                        <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 text-xs space-y-2">
                           <p><span className="font-black">Allergies:</span> {patientProfile?.medicalProfile?.allergies || 'No allergies reported'}</p>
                           <p><span className="font-black">Chronic:</span> {patientProfile?.medicalProfile?.chronicConditions || 'No conditions reported'}</p>
                           <p><span className="font-black">Blood Group:</span> {patientProfile?.medicalProfile?.bloodGroup || 'Not specified'}</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Likely Conditions</h4>
                        <div className="flex flex-wrap gap-2">
                          {selectedReport.possibleConditions?.map((c: string, i: number) => (
                            <span key={i} className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-3 py-1.5 rounded-lg text-[10px] font-black border border-blue-100 dark:border-blue-800">{c}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">Symptom Description</h4>
                      <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-3xl italic text-gray-700 dark:text-gray-300 font-medium">"{selectedReport.symptoms}"</div>
                    </div>

                    <div>
                      <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">AI Diagnostic Analysis</h4>
                      <div className="bg-blue-50 dark:bg-blue-900/20 p-8 rounded-[32px] border border-blue-100 dark:border-blue-800 text-gray-800 dark:text-gray-200 leading-relaxed font-medium">{selectedReport.analysis}</div>
                    </div>

                    <div className="p-6 bg-green-50 dark:bg-green-900/10 rounded-3xl border border-green-100 dark:border-green-800">
                      <h4 className="text-[10px] font-black text-green-600 dark:text-green-400 uppercase tracking-widest mb-2">AI Advice Provided to Patient</h4>
                      <p className="text-gray-700 dark:text-gray-300 text-xs font-bold leading-relaxed">{selectedReport.advice}</p>
                    </div>

                    <button onClick={() => { setHistoryTarget(null); setShowContactModal(true); }} className="w-full bg-blue-600 dark:bg-blue-700 text-white font-black py-5 rounded-[24px] shadow-2xl transition-all hover:scale-[1.01]">INITIATE RESPONSE</button>
                  </div>
                ) : (
                  <div className="h-full min-h-[500px] flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900/50 rounded-[40px] border-2 border-dashed border-gray-200 dark:border-gray-800 p-12 text-center text-gray-300 dark:text-gray-600">
                    <h4 className="text-2xl font-black">Select a clinical file to review</h4>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
              <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Access Requests</h2>
              <div className="grid gap-4">
                {pendingRequests.length === 0 ? (
                  <div className="bg-gray-50 dark:bg-gray-900 p-20 rounded-[48px] text-center border-2 border-dashed border-gray-200 dark:border-gray-800">
                    <p className="text-gray-400 font-black uppercase tracking-widest text-[10px]">No pending requests</p>
                  </div>
                ) : (
                  pendingRequests.map((req) => (
                    <div key={req.id} className="bg-white dark:bg-gray-900 p-8 rounded-[40px] border border-gray-100 dark:border-gray-800 shadow-sm flex items-center justify-between transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center text-2xl font-black">{req.fromName.charAt(0)}</div>
                        <div>
                          <p className="font-black text-gray-900 dark:text-white text-xl">{req.fromName}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">Network Request from {req.fromRole}</p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => handleConnectionAction(req.id, 'ACCEPTED')} className="bg-blue-600 dark:bg-blue-700 text-white px-6 py-3 rounded-2xl font-black text-xs">ACCEPT</button>
                        <button onClick={() => handleConnectionAction(req.id, 'REJECTED')} className="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-6 py-3 rounded-2xl font-black text-xs">DECLINE</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="max-w-3xl mx-auto space-y-10 animate-fade-in">
              <div className="flex justify-between items-center">
                <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Professional Profile</h2>
                <button onClick={handleUpdateProfile} disabled={loading} className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black shadow-xl hover:scale-105 transition-transform disabled:opacity-50">
                  {loading ? 'SAVING...' : 'SAVE CHANGES'}
                </button>
              </div>

              <div className="bg-white dark:bg-gray-900 p-10 rounded-[48px] border border-gray-100 dark:border-gray-800 shadow-sm space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest px-2">Academic Education</label>
                    <input 
                      type="text" 
                      value={profileForm.education} 
                      onChange={e => setProfileForm({...profileForm, education: e.target.value})} 
                      className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none font-bold text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 transition-all" 
                      placeholder="e.g. MBBS, MD - Cardiology"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest px-2">Medical Specialization</label>
                    <input 
                      type="text" 
                      value={profileForm.specialization} 
                      onChange={e => setProfileForm({...profileForm, specialization: e.target.value})} 
                      className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none font-bold text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 transition-all" 
                      placeholder="e.g. Neurologist"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest px-2">Years of Experience</label>
                    <input 
                      type="number" 
                      value={profileForm.experience} 
                      onChange={e => setProfileForm({...profileForm, experience: Number(e.target.value)})} 
                      className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none font-bold text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 transition-all" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest px-2">Primary Hospital Affiliation</label>
                    <input 
                      type="text" 
                      value={profileForm.hospital} 
                      onChange={e => setProfileForm({...profileForm, hospital: e.target.value})} 
                      className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none font-bold text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 transition-all" 
                      placeholder="e.g. Apollo Hospitals"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest px-2">Small Clinics / Other Affiliations (Comma separated)</label>
                  <textarea 
                    value={profileForm.smallClinics} 
                    onChange={e => setProfileForm({...profileForm, smallClinics: e.target.value})} 
                    className="w-full h-32 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none font-bold text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 transition-all resize-none" 
                    placeholder="e.g. City Health Clinic, North Side Center..."
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'clinics' && (
            <div className="max-w-4xl mx-auto space-y-10 animate-fade-in">
              <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Clinic Discovery</h2>
              <p className="text-gray-400 dark:text-gray-500 font-medium">Send connection requests to clinics to link your professional profile with their facilities.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {allClinics.length === 0 ? (
                  <div className="col-span-2 py-20 bg-gray-50 dark:bg-gray-900/50 rounded-[40px] border-2 border-dashed border-gray-200 dark:border-gray-800 text-center">
                    <p className="text-gray-400 font-black uppercase tracking-widest text-[10px]">No registered clinics found</p>
                  </div>
                ) : (
                  allClinics.map(clinic => {
                    const req = getClinicRequest(clinic.uid);
                    return (
                      <div key={clinic.uid} className="bg-white dark:bg-gray-900 p-8 rounded-[40px] border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-xl transition-all flex flex-col justify-between group">
                        <div className="flex items-start gap-4 mb-6">
                          <div className="w-16 h-16 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-2xl flex items-center justify-center text-3xl font-black">🏥</div>
                          <div className="flex-1">
                            <h4 className="font-black text-gray-900 dark:text-white text-xl">{clinic.displayName}</h4>
                            <p className="text-gray-400 dark:text-gray-500 font-bold text-xs mt-1 truncate max-w-[200px]">📍 {clinic.clinicDetails?.location || 'General Area'}</p>
                          </div>
                        </div>
                        
                        {req?.status === 'ACCEPTED' ? (
                          <div className="flex flex-col gap-2">
                            <div className="w-full py-3 px-4 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-2xl font-black text-xs text-center border border-green-100 dark:border-green-800 uppercase tracking-widest flex items-center justify-center gap-2">
                               <span className="w-2 h-2 bg-green-500 rounded-full"></span> Associated Clinic
                            </div>
                            {req.memberTag && (
                              <p className="text-center text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Role: {req.memberTag}</p>
                            )}
                          </div>
                        ) : req?.status === 'PENDING' ? (
                          <div className="w-full py-3 px-4 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 rounded-2xl font-black text-xs text-center border border-yellow-100 dark:border-yellow-800 uppercase tracking-widest">
                             Request Pending
                          </div>
                        ) : (
                          <button 
                            onClick={() => sendClinicConnectionRequest(clinic)}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black text-xs transition-all shadow-lg hover:scale-[1.02]"
                          >
                            REQUEST ASSOCIATION
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'patients' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
               <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Connected Patients</h2>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {connectedPatients.length === 0 ? <p className="text-gray-400 font-bold italic">No active connections found.</p> : connectedPatients.map((pat) => (
                   <div key={pat.id} className="bg-white dark:bg-gray-900 p-8 rounded-[40px] border border-gray-100 dark:border-gray-800 shadow-sm group hover:shadow-xl transition-all transition-colors">
                      <div className="flex items-center gap-4 mb-6">
                         <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 text-gray-400 rounded-2xl flex items-center justify-center text-xl font-black group-hover:bg-blue-600 group-hover:text-white transition-all">{pat.fromName.charAt(0)}</div>
                         <div>
                            <p className="font-black text-gray-900 dark:text-white text-xl">{pat.fromName}</p>
                            <p className="text-[10px] text-green-600 dark:text-green-400 font-black uppercase tracking-widest">Active Connection</p>
                         </div>
                      </div>
                      <button 
                        onClick={() => handleOpenHistory(pat)}
                        className="w-full bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 py-3 rounded-2xl font-black text-xs hover:bg-blue-600 hover:text-white transition-all"
                      >
                        VIEW MEDICAL HISTORY
                      </button>
                   </div>
                 ))}
               </div>
            </div>
          )}
        </div>
      </main>

      {/* Medical History Modal */}
      {historyTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-gray-950/90 backdrop-blur-md" onClick={() => setHistoryTarget(null)}></div>
           <div className="bg-white dark:bg-gray-900 w-full max-w-5xl h-[85vh] rounded-[40px] shadow-2xl overflow-hidden relative z-10 animate-fade-in-up flex flex-col transition-colors">
              <div className="p-8 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                <div>
                  <h3 className="text-3xl font-black text-gray-900 dark:text-white">Medical History</h3>
                  <p className="text-xs font-black text-blue-500 uppercase tracking-widest mt-1">Patient: {historyTarget.fromName}</p>
                </div>
                <button onClick={() => setHistoryTarget(null)} className="text-gray-400 hover:text-red-500 font-bold text-3xl transition-colors">&times;</button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {loadingHistory ? (
                   <div className="h-full flex items-center justify-center flex-col gap-4">
                     <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                     <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Gathering clinical records...</p>
                   </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    <div className="space-y-8">
                       <div className="flex items-center justify-between">
                         <h4 className="text-sm font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Shared Reports (Last 30 Days)</h4>
                         <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">{historyReports.length} Found</span>
                       </div>
                       <div className="space-y-6">
                         {historyReports.length === 0 ? (
                           <div className="p-12 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-[32px] text-center">
                             <p className="text-gray-400 font-bold italic text-sm">No reports shared in the last 30 days.</p>
                           </div>
                         ) : historyReports.map(report => (
                           <div key={report.id} className="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-[32px] border border-gray-100 dark:border-gray-800">
                             <div className="flex justify-between items-start mb-4">
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{new Date(report.timestamp?.seconds * 1000).toLocaleDateString()}</p>
                                <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase ${report.urgency === 'Critical' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'}`}>{report.urgency}</span>
                             </div>
                             <p className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3 line-clamp-3 italic">"{report.symptoms}"</p>
                             <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-4">{report.analysis}</div>
                           </div>
                         ))}
                       </div>
                    </div>
                    <div className="space-y-8">
                       <h4 className="text-sm font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">My Sent Advice History</h4>
                       <div className="space-y-6">
                         {historyAdvice.length === 0 ? (
                           <div className="p-12 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-[32px] text-center">
                             <p className="text-gray-400 font-bold italic text-sm">No clinical advice sent yet.</p>
                           </div>
                         ) : historyAdvice.map(msg => (
                           <div key={msg.id} className="bg-blue-50/50 dark:bg-blue-900/10 p-6 rounded-[32px] border border-blue-100 dark:border-blue-900/20">
                             <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">{new Date(msg.timestamp?.seconds * 1000).toLocaleString()}</p>
                             <p className="text-sm font-medium text-gray-700 dark:text-gray-300 leading-relaxed">{msg.content}</p>
                           </div>
                         ))}
                       </div>
                    </div>
                  </div>
                )}
              </div>
           </div>
        </div>
      )}

      {showContactModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-950/90 backdrop-blur-md" onClick={() => !isLiveActive && setShowContactModal(false)}></div>
          <div className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-fade-in-up">
            <div className="p-8 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
              <h3 className="text-2xl font-black text-gray-900 dark:text-white">Clinical Guidance</h3>
              <button onClick={() => !isLiveActive && setShowContactModal(false)} className="text-gray-400 hover:text-red-500 font-bold text-2xl">&times;</button>
            </div>
            <div className="flex p-2 bg-gray-100 dark:bg-gray-800 mx-8 mt-6 rounded-2xl">
              <button onClick={() => setContactMode('message')} className={`flex-1 py-3 px-4 rounded-xl font-black text-sm transition-all ${contactMode === 'message' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600' : 'text-gray-500'}`}>Text Advice</button>
              <button onClick={() => setContactMode('call')} className={`flex-1 py-3 px-4 rounded-xl font-black text-sm transition-all ${contactMode === 'call' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600' : 'text-gray-500'}`}>Live Consult</button>
            </div>
            <div className="p-8">
              {contactMode === 'message' ? (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      Response for {selectedReport ? selectedReport.patientName : historyTarget?.fromName}
                    </label>
                    {selectedReport && (
                      <button onClick={handleAIDraft} disabled={isDrafting} className="text-xs font-black text-blue-600 dark:text-blue-400">✨ Support with AI Draft</button>
                    )}
                  </div>
                  <textarea value={messageDraft} onChange={(e) => setMessageDraft(e.target.value)} className="w-full h-44 p-6 rounded-[24px] bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 outline-none transition font-medium text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600" placeholder="Draft clinical advice..." />
                  <button onClick={handleSendMessage} disabled={isSending} className="w-full bg-blue-600 dark:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-xl hover:scale-[1.01] transition-all">
                    {isSending ? 'SENDING...' : 'DISPATCH RESPONSE'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center py-6">
                  {!isLiveActive ? (
                    <button onClick={startLiveConsultation} className="w-full bg-green-600 dark:bg-green-700 text-white font-black py-4 rounded-2xl shadow-lg transition-all hover:scale-[1.01]">INITIATE ENCRYPTED LINK</button>
                  ) : (
                    <div className="w-full space-y-6 text-center">
                      <p className="text-green-600 dark:text-green-400 font-black tracking-widest text-[10px] uppercase">Live Secure Link Active</p>
                      <div className="bg-gray-900 rounded-3xl p-6 h-48 overflow-y-auto text-left text-green-400 font-mono text-xs border border-green-900/30">{transcription || '> Audio input pending...'}</div>
                      <button onClick={stopLiveConsultation} className="w-full bg-red-600 dark:bg-red-700 py-4 rounded-2xl text-white font-black hover:scale-[1.01] transition-all">END CONSULTATION</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 5px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; } .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; }`}</style>
    </div>
  );
};
