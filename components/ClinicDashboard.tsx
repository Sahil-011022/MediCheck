
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { UserProfile, Appointment, ClinicDetails, ConnectionRequest, UserRole } from '../types';

interface ClinicDashboardProps {
  user: UserProfile;
  toggleTheme: () => void;
  theme: 'light' | 'dark';
}

type Tab = 'appointments' | 'associations' | 'profile';

const STAFF_TAGS = ['Owner', 'Lead Doctor', 'Consultant', 'Nurse', 'Admin', 'Intern'];

export const ClinicDashboard: React.FC<ClinicDashboardProps> = ({ user, toggleTheme, theme }) => {
  const [activeTab, setActiveTab] = useState<Tab>('appointments');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [pendingAssociations, setPendingAssociations] = useState<ConnectionRequest[]>([]);
  const [activeStaff, setActiveStaff] = useState<ConnectionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });
  
  const [clinicData, setClinicData] = useState<ClinicDetails>(user.clinicDetails || {
    facilities: [], staff: [], images: [], location: '', description: ''
  });
  
  const [selectedRequest, setSelectedRequest] = useState<ConnectionRequest | null>(null);
  const [selectedTag, setSelectedTag] = useState(STAFF_TAGS[0]);
  
  const [newFacility, setNewFacility] = useState('');
  const [newStaff, setNewStaff] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const qApps = query(collection(db, 'appointments'), where('clinicId', '==', user.uid));
    const unsubscribeApps = onSnapshot(qApps, (snapshot) => {
      const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Appointment));
      setAppointments(apps.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
      setLoading(false);
    });

    const qAssoc = query(
      collection(db, 'connection_requests'), 
      where('toId', '==', user.uid),
      where('toRole', '==', UserRole.CLINIC)
    );
    const unsubscribeAssoc = onSnapshot(qAssoc, (snapshot) => {
      const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ConnectionRequest));
      setPendingAssociations(all.filter(a => a.status === 'PENDING'));
      setActiveStaff(all.filter(a => a.status === 'ACCEPTED'));
    });

    return () => {
      unsubscribeApps();
      unsubscribeAssoc();
    };
  }, [user.uid]);

  const handleUpdateProfile = async () => {
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        clinicDetails: clinicData
      });
      setMessage({ text: 'Saved changes successfully!', type: 'success' });
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
    } catch (err) {
      setMessage({ text: 'Failed to update profile.', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 4000);
    }
  };

  const handleAssociationAction = async (requestId: string, status: 'ACCEPTED' | 'REJECTED', tag?: string) => {
    try {
      if (status === 'ACCEPTED') {
        await updateDoc(doc(db, 'connection_requests', requestId), { 
          status: 'ACCEPTED',
          memberTag: tag || 'Staff'
        });
        setMessage({ text: 'Staff member added to your facility.', type: 'success' });
      } else {
        await deleteDoc(doc(db, 'connection_requests', requestId));
        setMessage({ text: 'Request declined.', type: 'error' });
      }
      setSelectedRequest(null);
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const updateAppointmentStatus = async (id: string, status: 'CONFIRMED' | 'CANCELLED') => {
    try {
      await updateDoc(doc(db, 'appointments', id), { status });
    } catch (err) {
      alert('Failed to update appointment.');
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    files.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setClinicData(prev => ({
          ...prev,
          images: [...prev.images, reader.result as string]
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="flex min-h-[calc(100vh-64px)] bg-white dark:bg-gray-950 transition-colors">
      <aside className="w-[280px] bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 p-6 flex flex-col gap-6 sticky top-16">
        <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-50 dark:border-gray-700">
          <div className="w-10 h-10 bg-green-600 text-white rounded-xl flex items-center justify-center font-bold">H</div>
          <div>
            <p className="font-black text-gray-900 dark:text-white leading-none truncate w-32">{user.displayName}</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-black tracking-widest mt-1">Facility Portal</p>
          </div>
        </div>
        <nav className="space-y-1 flex-1">
          <button onClick={() => setActiveTab('appointments')} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'appointments' ? 'bg-white dark:bg-gray-800 shadow-sm text-green-600' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            Appointments
          </button>
          <button onClick={() => setActiveTab('associations')} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'associations' ? 'bg-white dark:bg-gray-800 shadow-sm text-green-600' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            Staff & Network
            {(pendingAssociations.length > 0) && <span className="ml-2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{pendingAssociations.length}</span>}
          </button>
          <button onClick={() => setActiveTab('profile')} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'profile' ? 'bg-white dark:bg-gray-800 shadow-sm text-green-600' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            Clinic Settings
          </button>
        </nav>
        <div className="p-0 pt-4 border-t border-gray-200 dark:border-gray-800">
          <button 
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all text-sm font-bold text-gray-700 dark:text-gray-300 shadow-sm"
          >
            <span className="text-lg">{theme === 'light' ? '🌙' : '☀️'}</span>
            <span>{theme === 'light' ? 'Dark' : 'Light'} Mode</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 p-10 overflow-y-auto relative">
        {message.text && (
          <div className={`fixed top-20 right-8 z-[100] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-fade-in-up border ${
            message.type === 'success' ? 'bg-green-600 text-white border-green-500' : 'bg-red-600 text-white border-red-500'
          }`}>
            <span className="text-xl">{message.type === 'success' ? '✨' : '⚠️'}</span>
            <span className="font-black text-sm tracking-tight">{message.text}</span>
            <button onClick={() => setMessage({ text: '', type: '' })} className="ml-2 hover:scale-125 transition-transform opacity-70 hover:opacity-100">&times;</button>
          </div>
        )}

        <div className="max-w-5xl mx-auto">
          {activeTab === 'appointments' && (
            <div className="space-y-8 animate-fade-in">
              <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Booking Center</h2>
              <div className="grid gap-4">
                {loading ? <p className="text-gray-400 dark:text-gray-600 font-bold text-center py-20 uppercase tracking-widest text-[10px]">Loading incoming requests...</p> : appointments.length === 0 ? <div className="text-center py-20 bg-gray-50 dark:bg-gray-900 rounded-[40px] border-2 border-dashed border-gray-200 dark:border-gray-800"><p className="text-gray-400 dark:text-gray-600 font-black uppercase tracking-widest text-xs">No active bookings</p></div> : appointments.map((app) => (
                  <div key={app.id} className="bg-white dark:bg-gray-900 p-6 rounded-[32px] border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all hover:shadow-lg dark:hover:shadow-green-900/10">
                    <div className="flex items-center gap-4">
                       <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center text-xl">👤</div>
                       <div>
                         <p className="font-black text-gray-900 dark:text-white text-lg">{app.patientName}</p>
                         <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">{app.date} • {app.time}</p>
                       </div>
                    </div>
                    <div className="flex-1 px-4">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400 italic">"{app.reason}"</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {app.status === 'PENDING' ? (
                        <>
                          <button onClick={() => updateAppointmentStatus(app.id, 'CONFIRMED')} className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-xs font-black shadow-lg shadow-green-100 dark:shadow-none hover:scale-105 transition-transform">CONFIRM</button>
                          <button onClick={() => updateAppointmentStatus(app.id, 'CANCELLED')} className="px-5 py-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-xl text-xs font-black hover:bg-red-100 dark:hover:bg-red-900/40 transition-all">REJECT</button>
                        </>
                      ) : (
                        <span className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase ${app.status === 'CONFIRMED' ? 'bg-green-50 dark:bg-green-900/20 text-green-600' : 'bg-red-50 dark:bg-red-900/20 text-red-600'}`}>
                          {app.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'associations' && (
            <div className="space-y-12 animate-fade-in pb-20">
              <section className="space-y-6">
                <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Pending Associations</h2>
                <div className="grid gap-4">
                  {pendingAssociations.length === 0 ? (
                    <div className="py-12 bg-gray-50 dark:bg-gray-900 rounded-[32px] text-center border-2 border-dashed border-gray-100 dark:border-gray-800">
                      <p className="text-gray-400 font-black uppercase tracking-widest text-[10px]">No pending staff requests</p>
                    </div>
                  ) : pendingAssociations.map(req => (
                    <div key={req.id} className="bg-white dark:bg-gray-900 p-6 rounded-[32px] border border-gray-100 dark:border-gray-800 shadow-sm flex items-center justify-between group">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center text-2xl font-black">👨‍⚕️</div>
                        <div>
                          <p className="font-black text-gray-900 dark:text-white text-xl">{req.fromName}</p>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{req.fromRole} Request</p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => setSelectedRequest(req)} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs hover:scale-105 transition-transform">APPROVE STAFF</button>
                        <button onClick={() => handleAssociationAction(req.id, 'REJECTED')} className="bg-gray-100 dark:bg-gray-800 text-gray-500 px-6 py-3 rounded-2xl font-black text-xs">DECLINE</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-6">
                <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Active Staff & Members</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {activeStaff.length === 0 ? (
                    <div className="col-span-full py-12 bg-gray-50 dark:bg-gray-900 rounded-[32px] text-center border-2 border-dashed border-gray-100 dark:border-gray-800">
                      <p className="text-gray-400 font-black uppercase tracking-widest text-[10px]">No linked staff yet</p>
                    </div>
                   ) : activeStaff.map(member => (
                    <div key={member.id} className="bg-white dark:bg-gray-900 p-6 rounded-[32px] border border-gray-100 dark:border-gray-800 shadow-sm flex items-center justify-between group">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-green-50 dark:bg-green-900/20 text-green-600 rounded-xl flex items-center justify-center text-xl">👤</div>
                        <div>
                          <p className="font-black text-gray-900 dark:text-white">{member.fromName}</p>
                          <span className="bg-blue-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">{member.memberTag || 'Staff'}</span>
                        </div>
                      </div>
                      <button onClick={() => handleAssociationAction(member.id, 'REJECTED')} className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded-xl transition-all">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                   ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="space-y-10 animate-fade-in pb-20">
              <div className="flex justify-between items-center">
                <h2 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">Clinic Profile</h2>
                <button onClick={handleUpdateProfile} className="bg-black dark:bg-blue-600 text-white px-8 py-3 rounded-2xl font-black shadow-xl hover:scale-105 transition-transform">SAVE UPDATES</button>
              </div>

              <div className="grid md:grid-cols-2 gap-10">
                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-900 p-8 rounded-[40px] border border-gray-100 dark:border-gray-800 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">About Facility</h4>
                    <textarea value={clinicData.description} onChange={e => setClinicData({...clinicData, description: e.target.value})} className="w-full h-32 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none outline-none focus:ring-2 focus:ring-green-500 font-medium text-gray-700 dark:text-gray-300" placeholder="Facility description..." />
                    <input type="text" value={clinicData.location} onChange={e => setClinicData({...clinicData, location: e.target.value})} className="w-full p-4 rounded-2xl bg-gray-50 dark:bg-gray-800 border-none outline-none focus:ring-2 focus:ring-green-500 font-bold text-gray-800 dark:text-gray-100" placeholder="Physical Address" />
                  </div>

                  <div className="bg-white dark:bg-gray-900 p-8 rounded-[40px] border border-gray-100 dark:border-gray-800 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Legacy Staff List (Manual)</h4>
                    <div className="flex gap-2">
                      <input type="text" value={newStaff} onChange={e => setNewStaff(e.target.value)} className="flex-1 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border-none font-medium dark:text-white" placeholder="Specialist name..." />
                      <button onClick={() => { if(newStaff) { setClinicData({...clinicData, staff: [...clinicData.staff, newStaff]}); setNewStaff(''); }}} className="bg-green-600 text-white px-4 rounded-xl font-black">+</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {clinicData.staff.map((s, i) => <span key={i} className="bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-400 flex items-center gap-2">{s} <button onClick={() => setClinicData({...clinicData, staff: clinicData.staff.filter((_, idx) => idx !== i)})} className="text-red-400">&times;</button></span>)}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-900 p-8 rounded-[40px] border border-gray-100 dark:border-gray-800 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Facility Visuals</h4>
                    <div className="grid grid-cols-3 gap-3">
                      {clinicData.images.map((img, i) => (
                        <div key={i} className="aspect-square rounded-xl overflow-hidden relative group">
                          <img src={img} className="w-full h-full object-cover" />
                          <button onClick={() => setClinicData({...clinicData, images: clinicData.images.filter((_, idx) => idx !== i)})} className="absolute inset-0 bg-red-500/50 text-white font-black items-center justify-center opacity-0 group-hover:flex transition-opacity">DELETE</button>
                        </div>
                      ))}
                      <button onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-300 dark:text-gray-600 hover:border-green-500 hover:text-green-500 transition-all font-black text-2xl">+</button>
                      <input type="file" hidden multiple ref={fileInputRef} onChange={handleImageUpload} accept="image/*" />
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-900 p-8 rounded-[40px] border border-gray-100 dark:border-gray-800 shadow-sm space-y-4">
                    <h4 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Clinical Assets</h4>
                    <div className="flex gap-2">
                      <input type="text" value={newFacility} onChange={e => setNewFacility(e.target.value)} className="flex-1 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border-none font-medium dark:text-white" placeholder="e.g. ICU, Lab, Pharmacy" />
                      <button onClick={() => { if(newFacility) { setClinicData({...clinicData, facilities: [...clinicData.facilities, newFacility]}); setNewFacility(''); }}} className="bg-green-600 text-white px-4 rounded-xl font-black">+</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {clinicData.facilities.map((f, i) => <span key={i} className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 px-3 py-1.5 rounded-lg text-xs font-bold text-green-700 dark:text-green-400">{f} <button onClick={() => setClinicData({...clinicData, facilities: clinicData.facilities.filter((_, idx) => idx !== i)})} className="ml-1 text-green-400">&times;</button></span>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Approval Tag Selection Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md">
          <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-[32px] shadow-2xl p-8 space-y-6 animate-fade-in-up">
            <h3 className="text-2xl font-black text-gray-900 dark:text-white">Assign Staff Role</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Select the official role for <span className="font-black text-blue-600">{selectedRequest.fromName}</span> at your facility.</p>
            
            <div className="grid grid-cols-2 gap-3">
              {STAFF_TAGS.map(tag => (
                <button 
                  key={tag} 
                  onClick={() => setSelectedTag(tag)}
                  className={`py-3 rounded-xl text-xs font-black transition-all border ${selectedTag === tag ? 'bg-blue-600 text-white border-blue-600 shadow-lg' : 'bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-500 hover:border-blue-300'}`}
                >
                  {tag}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <button 
                onClick={() => handleAssociationAction(selectedRequest.id, 'ACCEPTED', selectedTag)}
                className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl hover:scale-[1.02] transition-transform"
              >
                CONFIRM ASSOCIATION
              </button>
              <button 
                onClick={() => setSelectedRequest(null)}
                className="w-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-black py-4 rounded-2xl"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
