
import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile 
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { UserRole } from '../types';
import { Logo } from './App';

interface AuthProps {
  onAuthSuccess: (user: any) => void;
}

type AuthStep = 'choice' | 'form';

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [step, setStep] = useState<AuthStep>('choice');
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.PATIENT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
        if (userDoc.exists()) {
          onAuthSuccess({ ...userCredential.user, ...userDoc.data() });
        } else {
          setError("User profile not found. Please register.");
        }
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });
        
        const userData: any = {
          uid: userCredential.user.uid,
          email,
          displayName: name,
          phoneNumber: phoneNumber,
          role: role
        };

        if (role === UserRole.CLINIC) {
          userData.clinicDetails = {
            facilities: [],
            staff: [],
            images: [],
            location: '',
            description: ''
          };
        }

        if (role === UserRole.DOCTOR) {
          userData.specialization = specialization;
        }

        await setDoc(doc(db, 'users', userCredential.user.uid), userData);
        onAuthSuccess(userData);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const selectRole = (selectedRole: UserRole) => {
    setRole(selectedRole);
    setStep('form');
  };

  const getRoleDisplayName = (r: UserRole) => {
    if (r === UserRole.CLINIC) return 'Clinic/Hospital';
    return r.charAt(0) + r.slice(1).toLowerCase();
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4 bg-cover bg-center bg-no-repeat relative"
      style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&q=80&w=2070")' }}
    >
      <div className="absolute inset-0 bg-blue-950/60 dark:bg-gray-950/80 backdrop-blur-sm transition-colors duration-500"></div>

      <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-md rounded-[48px] shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row relative z-10 animate-fade-in border border-white/20 dark:border-gray-800 transition-colors">
        <div className="hidden md:flex md:w-4/12 bg-blue-600 dark:bg-blue-800 p-8 text-white flex-col justify-between transition-colors">
          <div>
            <Logo hideText className="mb-8 p-3 bg-white/10 rounded-3xl inline-flex shadow-inner border border-white/10" />
            <h1 className="text-4xl font-black mb-4 leading-tight tracking-tight">MediCheck</h1>
            <p className="text-blue-100 font-medium opacity-80 leading-relaxed">Connecting patient records, AI diagnostics, and clinical expertise in one platform.</p>
          </div>
          <div className="text-[10px] uppercase font-black tracking-widest opacity-40">© 2025 Medicheck Healthcare</div>
        </div>

        <div className="w-full md:w-8/12 p-8 lg:p-12 text-gray-900 dark:text-gray-100">
          {step === 'choice' ? (
            <div className="animate-fade-in-up">
              <h2 className="text-3xl font-black mb-2 tracking-tight">Access Health Portal</h2>
              <p className="text-gray-500 dark:text-gray-400 mb-10 font-medium">Select your primary role to proceed with sign-in or registration.</p>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button onClick={() => selectRole(UserRole.PATIENT)} className="p-6 border-2 border-gray-100 dark:border-gray-800 rounded-3xl flex flex-col items-center gap-3 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all group">
                  <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/40 rounded-2xl flex items-center justify-center text-2xl group-hover:bg-blue-600 group-hover:text-white transition-colors">👤</div>
                  <div className="text-center">
                    <h3 className="font-black">Patient</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">AI Monitoring</p>
                  </div>
                </button>
                <button onClick={() => selectRole(UserRole.DOCTOR)} className="p-6 border-2 border-gray-100 dark:border-gray-800 rounded-3xl flex flex-col items-center gap-3 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all group">
                  <div className="w-14 h-14 bg-indigo-100 dark:bg-indigo-900/40 rounded-2xl flex items-center justify-center text-2xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">👨‍⚕️</div>
                  <div className="text-center">
                    <h3 className="font-black">Doctor</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Clinical Desk</p>
                  </div>
                </button>
                <button onClick={() => selectRole(UserRole.CLINIC)} className="p-6 border-2 border-gray-100 dark:border-gray-800 rounded-3xl flex flex-col items-center gap-3 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all group">
                  <div className="w-14 h-14 bg-green-100 dark:bg-green-900/40 rounded-2xl flex items-center justify-center text-2xl group-hover:bg-green-600 group-hover:text-white transition-colors">🏥</div>
                  <div className="text-center">
                    <h3 className="font-black">Clinic/Hospital</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Facility Hub</p>
                  </div>
                </button>
              </div>
              <div className="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800 text-center">
                <button onClick={() => { setIsLogin(true); setStep('form'); }} className="text-blue-600 dark:text-blue-400 font-black hover:underline tracking-tight">Already have an account? Sign In</button>
              </div>
            </div>
          ) : (
            <div className="animate-fade-in max-w-md mx-auto">
              <button onClick={() => setStep('choice')} className="mb-6 text-sm text-blue-600 dark:text-blue-400 font-bold flex items-center gap-2 hover:underline">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" /></svg>
                Change Role ({getRoleDisplayName(role)})
              </button>
              <h2 className="text-3xl font-black mb-6 tracking-tight">{isLogin ? 'Welcome Back' : `New ${getRoleDisplayName(role)} Account`}</h2>
              {error && <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-4 rounded-2xl mb-8 text-xs font-black border border-red-100 dark:border-red-800 shadow-sm">{error}</div>}
              <form onSubmit={handleAuth} className="space-y-4">
                {!isLogin && (
                  <>
                    <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-5 py-4 rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-transparent outline-none focus:border-blue-500 dark:focus:border-blue-600 transition-all font-medium placeholder-gray-400 dark:placeholder-gray-600" placeholder={role === UserRole.CLINIC ? 'Hospital/Clinic Name' : 'Full Name'} />
                    {role === UserRole.DOCTOR && (
                      <input type="text" required value={specialization} onChange={(e) => setSpecialization(e.target.value)} className="w-full px-5 py-4 rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-transparent outline-none focus:border-blue-500 dark:focus:border-blue-600 transition-all font-medium placeholder-gray-400 dark:placeholder-gray-600" placeholder="Specialization (e.g. Cardiologist)" />
                    )}
                    <input type="tel" required value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="w-full px-5 py-4 rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-transparent outline-none focus:border-blue-500 dark:focus:border-blue-600 transition-all font-medium placeholder-gray-400 dark:placeholder-gray-600" placeholder="Contact Number" />
                  </>
                )}
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-5 py-4 rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-transparent outline-none focus:border-blue-500 dark:focus:border-blue-600 transition-all font-medium placeholder-gray-400 dark:placeholder-gray-600" placeholder="Email Address" />
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-5 py-4 rounded-2xl border-2 border-gray-100 dark:border-gray-800 bg-transparent outline-none focus:border-blue-500 dark:focus:border-blue-600 transition-all font-medium placeholder-gray-400 dark:placeholder-gray-600" placeholder="Password" />
                <button type="submit" disabled={loading} className="w-full bg-blue-600 dark:bg-blue-700 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-black py-5 rounded-3xl shadow-2xl shadow-blue-500/20 transition-all hover:scale-[1.02]">
                  {loading ? 'PROCESSING...' : (isLogin ? 'SIGN IN' : 'CREATE ACCOUNT')}
                </button>
              </form>
              <div className="mt-8 text-center">
                <button onClick={() => setIsLogin(!isLogin)} className="text-xs text-gray-400 dark:text-gray-500 font-black uppercase tracking-widest hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                  {isLogin ? "Need an account? Register" : "Already registered? Login"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
