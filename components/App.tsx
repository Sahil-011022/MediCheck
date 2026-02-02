
import React, { useState, useEffect } from 'react';
import { Auth } from './Auth';
import { PatientDashboard } from './PatientDashboard';
import { DoctorDashboard } from './DoctorDashboard';
import { ClinicDashboard } from './ClinicDashboard';
import { UserRole, UserProfile } from '../types';
import { auth, db } from '../firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

export const Logo: React.FC<{ className?: string, hideText?: boolean }> = ({ className = "h-8", hideText = false }) => (
  <div className={`flex items-center gap-3 ${className}`}>
    <div className="relative w-10 h-10 flex items-center justify-center">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <rect x="38" y="5" width="24" height="40" rx="12" fill="#FFFFFF" className="drop-shadow-sm" />
        <rect x="5" y="38" width="40" height="24" rx="12" fill="#3B82F6" className="drop-shadow-sm" />
        <rect x="38" y="55" width="24" height="40" rx="12" fill="#10B981" className="drop-shadow-sm" />
        <rect x="55" y="38" width="40" height="24" rx="12" fill="#E5E7EB" className="drop-shadow-sm" />
        <path d="M25 50 L40 50 L45 40 L55 60 L60 50 L75 50" stroke="#374151" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
    {!hideText && <span className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">Medicheck</span>}
  </div>
);

const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return 'dark'; 
    }
    return 'dark';
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const userDoc = await getDoc(doc(db, 'users', fbUser.uid));
        if (userDoc.exists()) {
          setUser(userDoc.data() as UserProfile);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
  };

  const renderDashboard = () => {
    if (!user) return null;
    switch (user.role) {
      case UserRole.PATIENT: return <PatientDashboard user={user} toggleTheme={toggleTheme} theme={theme} />;
      case UserRole.DOCTOR: return <DoctorDashboard user={user} toggleTheme={toggleTheme} theme={theme} />;
      case UserRole.CLINIC: return <ClinicDashboard user={user} toggleTheme={toggleTheme} theme={theme} />;
      default: return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400 font-black tracking-widest text-[10px] uppercase">Connecting to MediCheck...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Auth onAuthSuccess={setUser} />;
  }

  const roleLabel = user.role === UserRole.CLINIC ? 'CLINIC / HOSPITAL' : user.role;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors duration-300">
      <nav className="bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-6">
            <div className="hidden md:block text-right">
              <p className="text-sm font-black text-gray-900 dark:text-white leading-none">{user.displayName}</p>
              <p className="text-[9px] uppercase tracking-widest font-black text-blue-500 mt-1">{roleLabel}</p>
            </div>
            <button onClick={handleLogout} className="text-xs font-black text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors uppercase tracking-widest">Logout</button>
          </div>
        </div>
      </nav>
      <main>
        {renderDashboard()}
      </main>
    </div>
  );
};

export default App;
