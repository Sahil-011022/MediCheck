import React, { useState, useEffect, useMemo, useRef } from 'react';
import { analyzeSymptoms, Attachment } from '../services/geminiService';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, query, where, onSnapshot, getDocs, doc, updateDoc, setDoc } from 'firebase/firestore';
import { UserProfile, MedicalProfile, Appointment, UserRole, ConnectionRequest } from '../types';
import { AICompanion } from './AICompanion';

interface PatientDashboardProps {
  user: UserProfile;
  toggleTheme: () => void;
  theme: 'light' | 'dark';
}

type Tab = 'analysis' | 'pharmacy' | 'companion' | 'inbox' | 'profile' | 'appointments' | 'find-doctors' | 'emergency' | 'my-reports';

const INDIAN_EMERGENCY_NUMBERS = [
  { label: 'Ambulance', number: '102', description: 'National ambulance service for non-trauma cases', icon: '🚑' },
  { label: 'Emergency Response (108)', number: '108', description: 'Free emergency response for accidents and critical trauma', icon: '🏥' },
  { label: 'Mental Health (Tele MANAS)', number: '14416', description: '24/7 mental health counseling and support', icon: '🧠' },
  { label: 'Poison Control', number: '1066', description: 'Emergency support for accidental poisoning/bites', icon: '🧪' }
];

export const PatientDashboard: React.FC<PatientDashboardProps> = ({ user, toggleTheme, theme }) => {
  const [activeTab, setActiveTab] = useState<Tab>('analysis');
  const [symptoms, setSymptoms] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [inboxMessages, setInboxMessages] = useState<any[]>([]);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [myReports, setMyReports] = useState<any[]>([]);
  
  const [availableDoctors, setAvailableDoctors] = useState<UserProfile[]>([]);
  const [connectionRequests, setConnectionRequests] = useState<ConnectionRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [clinics, setClinics] = useState<any[]>([]);
  const [myAppointments, setMyAppointments] = useState<Appointment[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<any>(null);
  const [selectedDoctorProfile, setSelectedDoctorProfile] = useState<UserProfile | null>(null);
  const [appointmentForm, setAppointmentForm] = useState({ date: '', time: '', reason: '' });

  const [attachments, setAttachments] = useState<{file: File, preview: string, data: string, mimeType: string}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [confirmCall, setConfirmCall] = useState<{ label: string, number: string } | null>(null);

  const [profilePhone, setProfilePhone] = useState(user.phoneNumber || '');
  const [medicalProfile, setMedicalProfile] = useState<MedicalProfile>(user.medicalProfile || {
    dob: '', gender: '', bloodGroup: '', allergies: '', chronicConditions: ''
  });

  const connectedDoctors = useMemo(() => 
    connectionRequests.filter(r => r.status === 'ACCEPTED'), 
    [connectionRequests]
  );

  useEffect(() => {
    const qMessages = query(collection(db, 'doctorMessages'), where('patientId', '==', user.uid));
    const unsubscribeMessages = onSnapshot(qMessages, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setInboxMessages(messages.sort((a: any, b: any) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    });

    const qRequests = query(collection(db, 'connection_requests'), where('fromId', '==', user.uid));
    const unsubscribeRequests = onSnapshot(qRequests, (snapshot) => {
      setConnectionRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ConnectionRequest)));
    });

    const qApps = query(collection(db, 'appointments'), where('patientId', '==', user.uid));
    const unsubscribeApps = onSnapshot(qApps, (snapshot) => {
      const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Appointment));
      setMyAppointments(apps.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    });

    const qReports = query(collection(db, 'reports'), where('patientId', '==', user.uid));
    const unsubscribeReports = onSnapshot(qReports, (snapshot) => {
      // FIX: Explicitly cast mapping to any to allow sorting by timestamp fields which aren't inferred correctly by TS.
      const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setMyReports(reports.sort((a: any, b: any) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    });

    return () => {
      unsubscribeMessages();
      unsubscribeRequests();
      unsubscribeApps();
      unsubscribeReports();
    };
  }, [user.uid]);

  // Handle marking messages as read automatically
  useEffect(() => {
    if (activeTab === 'inbox') {
      const unread = inboxMessages.filter(m => !m.read);
      unread.forEach(async (msg) => {
        try {
          await updateDoc(doc(db, 'doctorMessages', msg.id), { read: true });
        } catch (e) {
          console.error("Failed to mark message as read", e);
        }
      });
    }
  }, [activeTab, inboxMessages]);

  useEffect(() => {
    const fetchData = async () => {
      const qClinics = query(collection(db, 'users'), where('role', '==', UserRole.CLINIC));
      const snapClinics = await getDocs(qClinics);
      setClinics(snapClinics.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      const qDoctors = query(collection(db, 'users'), where('role', '==', UserRole.DOCTOR));
      const snapDoctors = await getDocs(qDoctors);
      // FIX: Map doc.id to uid to align with UserProfile type definition.
      setAvailableDoctors(snapDoctors.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    };
    fetchData();
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    for (const file of files) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        setAttachments(prev => [...prev, {
          file,
          preview: URL.createObjectURL(file),
          data: base64String,
          mimeType: file.type
        }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const sendConnectionRequest = async (targetId: string, targetName: string) => {
    const requestId = `${user.uid}_${targetId}`;
    try {
      await setDoc(doc(db, 'connection_requests', requestId), {
        fromId: user.uid,
        fromName: user.displayName,
        fromRole: user.role,
        toId: targetId,
        toName: targetName,
        status: 'PENDING',
        timestamp: serverTimestamp()
      });
      setMessage({ text: `Connection request sent to Dr. ${targetName}!`, type: 'success' });
    } catch (err) {
      setMessage({ text: 'Failed to send request.', type: 'error' });
    }
  };

  const getRequestStatus = (targetId: string) => {
    const req = connectionRequests.find(r => r.toId === targetId);
    return req ? req.status : 'NONE';
  };

  const handleBookAppointment = async () => {
    if (!selectedClinic || !appointmentForm.date || !appointmentForm.time) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'appointments'), {
        patientId: user.uid,
        patientName: user.displayName,
        clinicId: selectedClinic.id,
        clinicName: selectedClinic.displayName,
        date: appointmentForm.date,
        time: appointmentForm.time,
        reason: appointmentForm.reason,
        status: 'PENDING',
        timestamp: serverTimestamp()
      });
      setMessage({ text: 'Appointment request sent!', type: 'success' });
      setSelectedClinic(null);
      setAppointmentForm({ date: '', time: '', reason: '' });
    } catch (err) {
      setMessage({ text: 'Booking failed.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        phoneNumber: profilePhone,
        medicalProfile: medicalProfile
      });
      setMessage({ text: 'Profile updated!', type: 'success' });
    } catch (err) {
      setMessage({ text: 'Update failed.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!symptoms.trim() && attachments.length === 0) return;
    setLoading(true);
    try {
      const payload: Attachment[] = attachments.map(a => ({ data: a.data, mimeType: a.mimeType }));
      const result = await analyzeSymptoms(symptoms, payload);
      setAnalysis(result);
    } catch (err) {
      setMessage({ text: 'Analysis failed.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSendToDoctor = async () => {
    if (!analysis) return;
    if (connectedDoctors.length === 0) {
      setMessage({ text: 'Please connect with a doctor first to share reports.', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      await addDoc(collection(db, 'reports'), {
        patientId: user.uid,
        patientName: user.displayName,
        symptoms,
        analysis: analysis.analysis,
        possibleConditions: analysis.possibleConditions,
        urgency: analysis.urgency,
        advice: analysis.advice,
        timestamp: serverTimestamp(),
        sharedWith: connectedDoctors.map(d => d.toId)
      });
      setMessage({ text: `Report shared with ${connectedDoctors.length} doctor(s).`, type: 'success' });
      setSymptoms('');
      setAnalysis(null);
      setAttachments([]);
    } catch (err) {
      setMessage({ text: 'Dispatch failed.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleFindPharmacies = async () => {
    setLocating(true);
    try {
      if (!navigator.geolocation) {
        window.open('https://www.google.com/maps/search/pharmacies+near+me', '_blank');
        setLocating(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          const mapsUrl = `https://www.google.com/maps/search/pharmacies/@${latitude},${longitude},15z`;
          window.open(mapsUrl, '_blank');
          setLocating(false);
        }, 
        () => {
          window.open('https://www.google.com/maps/search/pharmacies+near+me', '_blank');
          setLocating(false);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } catch (err) {
      window.open('https://www.google.com/maps/search/pharmacies+near+me', '_blank');
      setLocating(false);
    }
  };

  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Speech recognition is not supported.");
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setSymptoms(prev => prev + (prev ? ' ' : '') + transcript);
    };
    recognition.start();
  };

  const NavItem = ({ id, label, icon, badge, isUrgent }: { id: Tab, label: string, icon: React.ReactNode, badge?: number, isUrgent?: boolean }) => (
    <button onClick={() => setActiveTab(id)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[14px] transition-all group ${activeTab === id ? (isUrgent ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 shadow-sm border border-red-100 dark:border-red-900' : 'bg-gray-100 dark:bg-gray-800 font-bold text-gray-900 dark:text-white shadow-sm') : 'hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-700 dark:text-gray-400'}`}>
      <div className="flex items-center gap-3">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs transition-colors ${activeTab === id ? '' : 'bg-gray-100 dark:bg-gray-800'}`}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      {badge ? <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{badge}</span> : null}
      {isUrgent && activeTab !== id && <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>}
    </button>
  );

  return (
    <div className="flex min-h-[calc(100vh-64px)] bg-white dark:bg-gray-950 transition-colors">
      <aside className="w-[280px] bg-[#f9f9f9] dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-[calc(100vh-64px)] sticky top-16 transition-colors">
        <div className="p-3 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
          <button onClick={() => { setActiveTab('analysis'); setAnalysis(null); setSymptoms(''); setAttachments([]); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-800 transition-all mb-1">
             <span className="text-gray-400">🆕</span> New analysis
          </button>
          <div className="space-y-0.5">
            <h4 className="px-3 text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase mb-2 mt-4 tracking-widest">Crisis Help</h4>
            <NavItem id="emergency" label="Emergency SOS" isUrgent={true} icon={<span className="text-red-500">⚡</span>} />
          </div>
          <div className="space-y-0.5">
            <h4 className="px-3 text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase mb-2 mt-4 tracking-widest">Medical Hub</h4>
            <NavItem id="analysis" label="Symptom AI" icon="🩺" />
            <NavItem id="find-doctors" label="Find Doctors" icon="🔍" />
            <NavItem id="companion" label="AI Buddy" icon="🤖" />
            <NavItem id="pharmacy" label="Pharmacy Finder" icon="💊" />
            <NavItem id="appointments" label="Book Appointment" icon="🏥" />
          </div>
          <div className="space-y-0.5">
            <h4 className="px-3 text-[11px] font-black text-gray-400 dark:text-gray-500 uppercase mb-2 mt-4 tracking-widest">Records</h4>
            <NavItem id="inbox" label="Doctor Inbox" icon="✉️" badge={inboxMessages.filter(m => !m.read).length || undefined} />
            <NavItem id="my-reports" label="My Reports" icon="📊" />
            <NavItem id="profile" label="Profile" icon="👤" />
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
        <div className="max-w-4xl mx-auto px-8 py-12">
          {message.text && (
            <div className={`mb-8 p-4 rounded-2xl flex items-center animate-fade-in border shadow-sm ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800'}`}>
              <span className="flex-1 font-bold text-sm">{message.text}</span>
              <button onClick={() => setMessage({ text: '', type: '' })} className="ml-2 font-black">&times;</button>
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="space-y-8 animate-fade-in">
              <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">AI Health Scan</h2>
              {!analysis ? (
                <div className="space-y-6">
                  <div className="relative">
                    <textarea className="w-full h-56 p-8 rounded-[40px] border-2 border-gray-50 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900 focus:bg-white dark:focus:bg-gray-800 focus:border-blue-500 outline-none resize-none transition-all text-xl font-medium text-gray-800 dark:text-gray-100" placeholder="Describe symptoms or clinical context..." value={symptoms} onChange={(e) => setSymptoms(e.target.value)} />
                    <div className="absolute bottom-6 right-8 flex gap-3">
                       <button onClick={startVoiceInput} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-100 dark:border-gray-700 shadow-lg'}`}>🎙️</button>
                       <button onClick={() => fileInputRef.current?.click()} className="w-12 h-12 rounded-full flex items-center justify-center bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-100 dark:border-gray-700 shadow-lg hover:text-blue-500 transition-colors">📎</button>
                       <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" multiple accept="image/*,application/pdf" />
                    </div>
                  </div>
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-3xl border border-gray-100 dark:border-gray-800">
                      {attachments.map((a, i) => (
                        <div key={i} className="relative group w-24 h-24 bg-white dark:bg-gray-800 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
                           {a.mimeType.startsWith('image/') ? (
                             <img src={a.preview} alt="Attachment preview" className="w-full h-full object-cover" />
                           ) : (
                             <div className="w-full h-full flex flex-col items-center justify-center">
                               <span className="text-xl">📄</span>
                               <span className="text-[8px] font-bold text-gray-400 truncate w-20 px-1">{a.file.name}</span>
                             </div>
                           )}
                           <button onClick={() => removeAttachment(i)} className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={handleAnalyze} disabled={loading || (!symptoms.trim() && attachments.length === 0)} className="w-full bg-blue-600 dark:bg-blue-700 text-white font-black py-5 rounded-[24px] shadow-2xl transition-all hover:scale-[1.01] disabled:opacity-40">
                    {loading ? 'ANALYZING...' : 'RUN DIAGNOSTIC'}
                  </button>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-900 rounded-[40px] shadow-2xl border border-gray-100 dark:border-gray-800 p-10 animate-fade-in-up">
                  <div className="space-y-6">
                    <p className="text-gray-800 dark:text-gray-200 text-xl font-medium italic">"{analysis.analysis}"</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-3xl">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Likely Conditions</h4>
                        {analysis.possibleConditions.map((c: any, i: number) => <span key={i} className="inline-block bg-white dark:bg-gray-700 px-3 py-1 rounded-lg text-xs font-bold border border-gray-100 dark:border-gray-600 mr-2 mb-2">{c}</span>)}
                      </div>
                      <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-3xl border border-blue-100 dark:border-blue-800">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-2">AI Advice</h4>
                        <p className="text-gray-700 dark:text-gray-300 font-bold text-xs">{analysis.advice}</p>
                      </div>
                    </div>
                    <button onClick={handleSendToDoctor} className="w-full bg-blue-600 text-white font-black py-5 rounded-2xl shadow-xl hover:scale-[1.01] transition-all">SHARE WITH MEDICAL NETWORK</button>
                    <button onClick={() => setAnalysis(null)} className="w-full mt-4 text-gray-400 dark:text-gray-500 font-bold hover:text-gray-600 dark:hover:text-gray-300">Start New Analysis</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'find-doctors' && (
            <div className="space-y-10 animate-fade-in">
              <div className="flex justify-between items-center">
                <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Medical Network</h2>
                <div className="relative w-64">
                   <input type="text" placeholder="Search by name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-900 border-none outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm text-gray-800 dark:text-gray-100" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {availableDoctors
                  .filter(d => d.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(doctor => {
                    // FIX: Access doctor.uid as defined in UserProfile type.
                    const status = getRequestStatus(doctor.uid);
                    return (
                      <div key={doctor.uid} className="bg-white dark:bg-gray-900 p-6 rounded-[32px] border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col justify-between group hover:shadow-xl dark:hover:shadow-blue-900/10 transition-all">
                        <div className="flex items-start gap-4 mb-6">
                           <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center text-3xl">👨‍⚕️</div>
                           <div className="flex-1">
                             <h4 className="font-black text-gray-900 dark:text-white text-xl">Dr. {doctor.displayName}</h4>
                             <p className="text-blue-500 font-black text-[10px] uppercase tracking-widest mt-1">{doctor.specialization || 'General Practitioner'}</p>
                             <button onClick={() => setSelectedDoctorProfile(doctor)} className="mt-2 text-[10px] font-black text-gray-400 hover:text-blue-500 uppercase tracking-widest transition-colors">View Professional Profile</button>
                           </div>
                        </div>
                        {status === 'ACCEPTED' ? (
                          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-black text-xs uppercase bg-green-50 dark:bg-green-900/20 px-4 py-2 rounded-xl">
                            <span className="w-2 h-2 bg-green-600 dark:bg-green-400 rounded-full"></span> Connected
                          </div>
                        ) : status === 'PENDING' ? (
                          <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 font-black text-xs uppercase bg-yellow-50 dark:bg-yellow-900/20 px-4 py-2 rounded-xl">Request Pending</div>
                        ) : (
                          // FIX: Use doctor.uid instead of doctor.id.
                          <button onClick={() => sendConnectionRequest(doctor.uid, doctor.displayName)} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3 rounded-2xl transition-all shadow-lg shadow-blue-50 dark:shadow-none">CONNECT</button>
                        )}
                      </div>
                    );
                })}
              </div>
            </div>
          )}

          {activeTab === 'pharmacy' && (
            <div className="space-y-10 animate-fade-in">
               <div className="bg-blue-600 dark:bg-blue-900 rounded-[48px] p-16 text-center text-white relative overflow-hidden shadow-2xl">
                 <h2 className="text-5xl font-black mb-8 relative z-10">Pharmacy Finder</h2>
                 <button onClick={handleFindPharmacies} disabled={locating} className="px-12 py-5 bg-white text-blue-600 rounded-2xl font-black shadow-2xl hover:bg-gray-100 transition-all flex items-center justify-center gap-4 mx-auto relative z-10 hover:scale-[1.02] active:scale-95 disabled:opacity-50">
                   {locating ? 'LOCATING...' : 'SCAN NEAR ME'}
                 </button>
                 <div className="absolute -bottom-10 -right-10 opacity-10 text-[10rem] font-black select-none pointer-events-none">💊</div>
               </div>
               <div className="text-center py-20 bg-gray-50 dark:bg-gray-900/50 rounded-[40px] border-2 border-dashed border-gray-200 dark:border-gray-800">
                  <p className="text-gray-400 dark:text-gray-600 font-black uppercase tracking-widest text-xs">Direct Google Maps Integration</p>
                  <p className="text-gray-400 dark:text-gray-600 text-[10px] mt-2 italic font-medium">Scanning uses high-accuracy GPS to find pharmacies in your precise vicinity.</p>
               </div>
            </div>
          )}

          {activeTab === 'appointments' && (
            <div className="space-y-10 animate-fade-in">
               <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Clinical Bookings</h2>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="space-y-6">
                    <h3 className="text-sm font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Select Provider</h3>
                    <div className="space-y-3">
                      {clinics.map(clinic => (
                        <button key={clinic.id} onClick={() => setSelectedClinic(clinic)} className={`w-full text-left p-5 rounded-3xl border transition-all ${selectedClinic?.id === clinic.id ? 'bg-green-600 border-green-600 text-white shadow-xl' : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 text-gray-900 dark:text-gray-100 hover:border-green-200'}`}>
                          <p className="font-black">{clinic.displayName}</p>
                          <p className={`text-[10px] uppercase font-bold tracking-widest mt-1 ${selectedClinic?.id === clinic.id ? 'text-green-100' : 'text-gray-400 dark:text-gray-500'}`}>📍 {clinic.clinicDetails?.location || 'General Area'}</p>
                        </button>
                      ))}
                    </div>
                 </div>
                 <div className="space-y-6">
                    {selectedClinic ? (
                      <div className="space-y-6 animate-fade-in">
                        <div className="bg-white dark:bg-gray-900 p-8 rounded-[40px] border border-gray-100 dark:border-gray-800 shadow-sm space-y-4">
                          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Facility Details</h4>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 leading-relaxed">{selectedClinic.clinicDetails?.description || 'No description available.'}</p>
                          <div className="flex flex-wrap gap-2 pt-2">
                             {selectedClinic.clinicDetails?.facilities?.map((f: string, i: number) => (
                               <span key={i} className="bg-green-50 dark:bg-green-900/20 text-green-600 text-[9px] font-black px-2 py-1 rounded-lg border border-green-100 dark:border-green-800 uppercase">{f}</span>
                             ))}
                          </div>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-900 p-8 rounded-[40px] border border-gray-100 dark:border-gray-800">
                          <h4 className="font-black text-gray-800 dark:text-white mb-6">Schedule Visit</h4>
                          <div className="grid grid-cols-2 gap-4 mb-4">
                            <input type="date" className="p-4 rounded-2xl bg-white dark:bg-gray-800 font-bold text-xs border-none outline-none dark:text-white" value={appointmentForm.date} onChange={e => setAppointmentForm({...appointmentForm, date: e.target.value})} />
                            <input type="time" className="p-4 rounded-2xl bg-white dark:bg-gray-800 font-bold text-xs border-none outline-none dark:text-white" value={appointmentForm.time} onChange={e => setAppointmentForm({...appointmentForm, time: e.target.value})} />
                          </div>
                          <textarea className="w-full h-24 p-4 rounded-2xl bg-white dark:bg-gray-800 border-none outline-none font-medium text-xs dark:text-gray-200 mb-4" placeholder="Reason for visit..." value={appointmentForm.reason} onChange={e => setAppointmentForm({...appointmentForm, reason: e.target.value})} />
                          <button onClick={handleBookAppointment} disabled={loading} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black hover:scale-[1.01] transition-transform shadow-xl">REQUEST APPOINTMENT</button>
                        </div>
                      </div>
                    ) : (
                      <div className="h-full min-h-[400px] flex items-center justify-center border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-[40px]">
                        <p className="text-center text-gray-400 dark:text-gray-600 font-bold uppercase tracking-widest text-[10px]">Select a provider to view details and book</p>
                      </div>
                    )}
                 </div>
               </div>
            </div>
          )}

          {activeTab === 'inbox' && (
            <div className="space-y-8 animate-fade-in">
              <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Doctor Inbox</h2>
              {inboxMessages.length === 0 ? <p className="text-gray-400 font-bold">Inbox is empty.</p> : (
                <div className="space-y-4">
                  {inboxMessages.map(msg => (
                    <div key={msg.id} className={`bg-white dark:bg-gray-900 p-8 rounded-[40px] border shadow-sm transition-all ${msg.read ? 'border-gray-100 dark:border-gray-800' : 'border-blue-500 dark:border-blue-700 ring-2 ring-blue-500/10'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-black text-gray-900 dark:text-white text-lg">Dr. {msg.doctorName}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-bold mb-4 uppercase tracking-widest">{msg.timestamp?.toDate().toLocaleString()}</p>
                        </div>
                        {!msg.read && <span className="bg-blue-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase">New Response</span>}
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-2xl text-gray-700 dark:text-gray-300 leading-relaxed font-medium">{msg.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'emergency' && (
            <div className="space-y-8 animate-fade-in">
              <div className="bg-red-600 rounded-[40px] p-10 text-white shadow-2xl relative overflow-hidden">
                <div className="relative z-10">
                  <h2 className="text-4xl font-black mb-4 tracking-tight">Emergency Care</h2>
                  <p className="text-red-100 font-medium max-w-lg">Critical medical contacts for immediate assistance.</p>
                </div>
                <div className="absolute top-0 right-0 p-10 opacity-10 font-black text-[12rem] pointer-events-none select-none">SOS</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {INDIAN_EMERGENCY_NUMBERS.map((item, idx) => (
                  <button key={idx} onClick={() => setConfirmCall({ label: item.label, number: item.number })} className="group bg-white dark:bg-gray-900 p-8 rounded-[32px] border border-gray-100 dark:border-gray-800 shadow-sm hover:border-red-500 hover:shadow-2xl transition-all flex items-start gap-6 text-left w-full">
                    <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-2xl flex items-center justify-center text-3xl group-hover:bg-red-500 transition-all">{item.icon}</div>
                    <div className="flex-1">
                      <h4 className="font-black text-gray-900 dark:text-white text-xl">{item.label}</h4>
                      <p className="text-2xl font-black text-red-500 mb-2 mt-1">{item.number}</p>
                      <p className="text-sm text-gray-400 font-medium leading-relaxed">{item.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {activeTab === 'companion' && <AICompanion user={user} />}
          
          {activeTab === 'my-reports' && (
             <div className="space-y-8 animate-fade-in">
                <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Diagnostic Reports</h2>
                <div className="space-y-4">
                   {myReports.map(report => (
                     <div key={report.id} className="bg-white dark:bg-gray-900 p-8 rounded-[32px] border border-gray-100 dark:border-gray-800 shadow-sm">
                        <div className="flex justify-between mb-4">
                           <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{report.timestamp?.toDate().toLocaleString()}</span>
                           <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase ${report.urgency === 'Critical' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'}`}>{report.urgency}</span>
                        </div>
                        <p className="font-medium text-gray-700 dark:text-gray-300 italic mb-4">"{report.analysis.substring(0, 200)}..."</p>
                        <div className="flex flex-wrap gap-2">
                           {report.possibleConditions.map((c: string, i: number) => <span key={i} className="bg-gray-100 dark:bg-gray-800 text-[10px] px-2 py-1 rounded font-bold">{c}</span>)}
                        </div>
                     </div>
                   ))}
                </div>
             </div>
          )}

          {activeTab === 'profile' && (
            <div className="space-y-10 animate-fade-in max-w-2xl">
               <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Health Profile</h2>
               <div className="bg-white dark:bg-gray-900 p-10 rounded-[48px] border border-gray-100 dark:border-gray-800 shadow-sm space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 block">Blood Group</label>
                      <input type="text" className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none font-bold text-gray-800 dark:text-gray-100" value={medicalProfile.bloodGroup} onChange={e => setMedicalProfile({...medicalProfile, bloodGroup: e.target.value})} placeholder="e.g. O+" />
                    </div>
                    <div>
                       <label className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 block">Phone</label>
                       <input type="tel" className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none font-bold text-gray-800 dark:text-gray-100" value={profilePhone} onChange={e => setProfilePhone(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 block">Known Allergies</label>
                    <textarea className="w-full h-24 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none font-bold text-gray-800 dark:text-gray-100" value={medicalProfile.allergies} onChange={e => setMedicalProfile({...medicalProfile, allergies: e.target.value})} placeholder="None reported" />
                  </div>
                  <button onClick={handleUpdateProfile} disabled={loading} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black shadow-xl hover:scale-[1.01] transition-transform">SAVE CHANGES</button>
               </div>
            </div>
          )}
        </div>
      </main>

      {/* Doctor Professional Profile Modal */}
      {selectedDoctorProfile && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-6 bg-black/70 backdrop-blur-md">
          <div className="bg-white dark:bg-gray-900 w-full max-w-xl rounded-[48px] shadow-2xl overflow-hidden relative z-10 animate-fade-in-up">
            <div className="p-10 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex justify-between items-center">
               <div className="flex items-center gap-6">
                 <div className="w-20 h-20 bg-blue-600 text-white rounded-[24px] flex items-center justify-center text-4xl font-black shadow-lg">DR</div>
                 <div>
                   <h3 className="text-3xl font-black text-gray-900 dark:text-white">Dr. {selectedDoctorProfile.displayName}</h3>
                   <p className="text-blue-500 font-black uppercase tracking-widest text-xs mt-1">{selectedDoctorProfile.specialization || 'Clinical Specialist'}</p>
                 </div>
               </div>
               <button onClick={() => setSelectedDoctorProfile(null)} className="text-gray-300 hover:text-red-500 text-4xl font-light">&times;</button>
            </div>
            <div className="p-10 space-y-8">
               <div className="grid grid-cols-2 gap-8">
                 <div>
                   <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Academic Excellence</h4>
                   <p className="text-gray-800 dark:text-gray-200 font-bold leading-relaxed">{selectedDoctorProfile.education || 'Credentials pending verification.'}</p>
                 </div>
                 <div>
                   <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Experience</h4>
                   <p className="text-gray-800 dark:text-gray-200 font-bold leading-relaxed">{selectedDoctorProfile.experience || 0} Years in Clinical Practice</p>
                 </div>
               </div>
               <div>
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Primary Hospital Affiliation</h4>
                  <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
                     <span className="text-xl">🏥</span>
                     <p className="text-gray-800 dark:text-gray-200 font-black">{selectedDoctorProfile.hospital || 'Private Practice'}</p>
                  </div>
               </div>
               {selectedDoctorProfile.smallClinics && selectedDoctorProfile.smallClinics.length > 0 && (
                 <div>
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Other Clinic Affiliations</h4>
                    <div className="flex flex-wrap gap-2">
                       {selectedDoctorProfile.smallClinics.map((c, i) => <span key={i} className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-[10px] font-black px-3 py-1.5 rounded-xl border border-blue-100 dark:border-blue-800 uppercase">{c}</span>)}
                    </div>
                 </div>
               )}
               <button onClick={() => { sendConnectionRequest(selectedDoctorProfile.uid, selectedDoctorProfile.displayName); setSelectedDoctorProfile(null); }} className="w-full bg-blue-600 text-white font-black py-5 rounded-3xl shadow-xl hover:scale-[1.02] transition-transform">REQUEST CLINICAL CONNECTION</button>
            </div>
          </div>
        </div>
      )}

      {confirmCall && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-[32px] shadow-2xl p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-3xl flex items-center justify-center text-4xl mx-auto">📞</div>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white">Emergency Call</h3>
            <p className="text-gray-500 dark:text-gray-400">Call <span className="text-red-600 font-black">{confirmCall.label}</span> at <span className="font-black">{confirmCall.number}</span>?</p>
            <div className="flex flex-col gap-3">
              <button onClick={() => { window.location.href = `tel:${confirmCall.number}`; setConfirmCall(null); }} className="w-full bg-red-600 text-white font-black py-4 rounded-2xl shadow-xl">CALL NOW</button>
              <button onClick={() => setConfirmCall(null)} className="w-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-black py-4 rounded-2xl transition-all">CANCEL</button>
            </div>
          </div>
        </div>
      )}
      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 5px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; } .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; }`}</style>
    </div>
  );
};