import React, { useState, useEffect, useCallback } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  where,
  limit,
  orderBy, 
  addDoc,
  serverTimestamp,
  updateDoc,
  increment,
  arrayUnion,
  arrayRemove,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { cn } from './lib/utils';
import { translations, Language } from './lib/translations';
import { 
  Mic, 
  MicOff, 
  Gift, 
  LogOut, 
  Users, 
  Home, 
  User as UserIcon, 
  Plus, 
  ChevronRight,
  Trophy,
  Settings,
  Lock,
  Music,
  Trophy as TrophyIcon,
  Flame,
  Star,
  Crown,
  Diamond,
  Globe,
  ChevronDown,
  Info,
  Sun,
  Moon,
  Wallet,
  ShieldCheck,
  Award,
  Heart,
  ShoppingBag,
  Shirt,
  Search,
  MessageCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgoraRTC, { IAgoraRTCClient, ILocalAudioTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng';

// --- Types ---
interface UserProfile {
  uid: string;
  displayId: number;
  name: string;
  avatar: string;
  level: number;
  coins_balance: number;
  bio: string;
  role: 'admin' | 'user';
  createdAt: any;
}

interface Room {
  id: string;
  title: string;
  ownerId: string;
  topic: string;
  type: 'public' | 'followers' | 'private';
  memberCount: number;
  activeSpeakers: string[];
  createdAt: any;
}

// --- Constants ---
const AGORA_APP_ID = (import.meta as any).env.VITE_AGORA_APP_ID || '';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 100
    }
  }
};

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      try {
        const parsed = JSON.parse(event.error.message);
        if (parsed.error) {
          setErrorInfo(`Firestore Error: ${parsed.operationType} on ${parsed.path}`);
        }
      } catch {
        setErrorInfo(event.error.message);
      }
      setHasError(true);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-red-50 text-center">
        <h2 className="text-2xl font-bold text-red-600 mb-4">Oops! Something went wrong.</h2>
        <p className="text-gray-600 mb-6">{errorInfo || 'An unexpected error occurred.'}</p>
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold"
        >
          Reload App
        </button>
      </div>
    );
  }

  return <>{children}</>;
};

interface AdminUserRowProps {
  u: UserProfile;
  t: any;
  key?: any;
}

function AdminUserRow({ u, t }: AdminUserRowProps) {
  const [amount, setAmount] = useState('1');

  const handleSend = async () => {
    const val = parseInt(amount);
    if (isNaN(val) || val < 1) {
      alert("الرجاء إدخال رقم صحيح (بالآلاف)");
      return;
    }
    const totalCoins = val * 1000;
    try {
      await updateDoc(doc(db, 'users', u.uid), {
        coins_balance: increment(totalCoins)
      });
      alert(`تم إرسال ${totalCoins.toLocaleString()} كوين إلى ${u.name}`);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="bg-[var(--bg-card)] p-4 rounded-2xl border border-[var(--border-color)] flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-3">
        <img src={u.avatar} className="w-12 h-12 rounded-full border-2 border-teal-500/20" alt="" />
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{u.name}</div>
          <div className="text-[10px] text-[var(--text-muted)]">🪙 {u.coins_balance.toLocaleString()}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl px-2 border border-[var(--border-color)]">
          <input 
            type="number" 
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-14 bg-transparent text-center text-sm font-bold py-2 focus:outline-none"
            min="1"
          />
          <span className="text-[10px] text-[var(--text-muted)] font-bold pr-1">K</span>
        </div>
        <button 
          onClick={handleSend}
          className="bg-teal-500 text-white text-[10px] px-3 py-2 rounded-xl font-bold hover:bg-teal-600 transition-colors shadow-md whitespace-nowrap"
        >
          {(t as any).send_coins}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentScreen, setCurrentScreen] = useState<'discovery' | 'room' | 'profile' | 'admin' | 'messages'>('discovery');
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'famous' | 'following' | 'recent' | 'admin'>('famous');
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [lang, setLang] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('lang') as Language) || 'en';
    }
    return 'en';
  });

  useEffect(() => {
    localStorage.setItem('lang', lang);
  }, [lang]);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [videoMuted, setVideoMuted] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const t = translations[lang];

  const filteredRooms = rooms.filter(room => 
    room.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    room.topic.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Ensure profile exists
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
          // Generate a random 6-8 digit numeric ID
          const displayId = Math.floor(100000 + Math.random() * 9000000);
          
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            displayId: displayId,
            name: firebaseUser.displayName || 'User',
            avatar: firebaseUser.photoURL || `https://picsum.photos/seed/${firebaseUser.uid}/200`,
            level: 1,
            coins_balance: 10000000,
            bio: 'مرحباً بك في يَاري!',
            role: 'user',
            createdAt: serverTimestamp(),
          };
          try {
            await setDoc(userRef, newProfile);
            setProfile(newProfile);
          } catch (e) {
            handleFirestoreError(e, OperationType.WRITE, `users/${firebaseUser.uid}`);
          }
        } else {
          setProfile(userSnap.data() as UserProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Rooms Listener
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'rooms'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const roomsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room));
      setRooms(roomsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'rooms');
    });
    return unsubscribe;
  }, [user]);

  const seedRooms = async () => {
    if (!user) return;
    const sampleRooms = [
      { title: 'HAYAL', topic: 'Music', ownerId: 'sys1', memberCount: 6, activeSpeakers: ['sys1'], country: 'TR', avatar: 'https://picsum.photos/seed/h1/200/200', desc: 'HAYAL', type: 'public' },
      { title: 'süper yayıncı TUTSAK', topic: 'General', ownerId: 'sys2', memberCount: 9, activeSpeakers: ['sys2'], country: 'TR', avatar: 'https://picsum.photos/seed/h2/200/200', desc: 'TUTSAK', type: 'public' },
      { title: 'Dilan°', topic: 'Social', ownerId: 'sys3', memberCount: 3, activeSpeakers: ['sys3'], country: 'TR', avatar: 'https://picsum.photos/seed/h3/200/200', desc: 'Odama hoş geldin...', type: 'public' },
      { title: 'BŁØNĐ', topic: 'Music', ownerId: 'sys4', memberCount: 2, activeSpeakers: ['sys4'], country: 'TR', avatar: 'https://picsum.photos/seed/h4/200/200', desc: ':(', type: 'public' },
      { title: 'سوريا', topic: 'General', ownerId: 'sys5', memberCount: 2, activeSpeakers: ['sys5'], country: 'SY', avatar: 'https://picsum.photos/seed/h5/200/200', desc: 'Welcome', type: 'public' },
      { title: 'Global Chat', topic: 'Social', ownerId: 'sys6', memberCount: 15, activeSpeakers: ['sys6'], country: 'US', avatar: 'https://picsum.photos/seed/h6/200/200', desc: 'Hello world', type: 'public' },
      { title: 'Gaming Zone', topic: 'Games', ownerId: 'sys7', memberCount: 45, activeSpeakers: ['sys7'], country: 'SA', avatar: 'https://picsum.photos/seed/h7/200/200', desc: 'Let\'s play', type: 'public' },
      { title: 'Poetry Night', topic: 'Art', ownerId: 'sys8', memberCount: 12, activeSpeakers: ['sys8'], country: 'EG', avatar: 'https://picsum.photos/seed/h8/200/200', desc: 'Words and soul', type: 'public' },
      { title: 'Tech Talk', topic: 'Tech', ownerId: 'sys9', memberCount: 8, activeSpeakers: ['sys9'], country: 'IN', avatar: 'https://picsum.photos/seed/h9/200/200', desc: 'Future is here', type: 'public' },
      { title: 'English Learning', topic: 'Education', ownerId: 'sys10', memberCount: 20, activeSpeakers: ['sys10'], country: 'GB', avatar: 'https://picsum.photos/seed/h10/200/200', desc: 'Practice together', type: 'public' },
    ];

    for (const r of sampleRooms) {
      try {
        await addDoc(collection(db, 'rooms'), {
          ...r,
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.error("Seed failed", e);
      }
    }
  };

  // Profile Listener
  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        setProfile(doc.data() as UserProfile);
      }
    });
    return unsubscribe;
  }, [user]);

  // All Users Listener (Admin only)
  useEffect(() => {
    if (!user || user.email !== 'gemini205799@gmail.com') return;
    const q = query(collection(db, 'users'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => doc.data() as UserProfile);
      setAllUsers(usersData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });
    return unsubscribe;
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleCreateRoom = async () => {
    if (!user || !profile) return;
    const roomTitle = prompt("أدخل اسم الغرفة:");
    if (!roomTitle) return;

    const newRoom = {
      title: roomTitle,
      ownerId: user.uid,
      topic: 'عام',
      type: 'public',
      memberCount: 1,
      activeSpeakers: [user.uid],
      createdAt: serverTimestamp(),
    };

    try {
      const docRef = await addDoc(collection(db, 'rooms'), newRoom);
      const roomWithId = { id: docRef.id, ...newRoom } as Room;
      setActiveRoom(roomWithId);
      setCurrentScreen('room');
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'rooms');
    }
  };

  const joinRoom = async (room: Room) => {
    setActiveRoom(room);
    setCurrentScreen('room');
    try {
      await updateDoc(doc(db, 'rooms', room.id), {
        memberCount: increment(1)
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `rooms/${room.id}`);
    }
  };

  const leaveRoom = async () => {
    if (!activeRoom || !user) return;
    try {
      await updateDoc(doc(db, 'rooms', activeRoom.id), {
        memberCount: increment(-1),
        activeSpeakers: arrayRemove(user.uid)
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `rooms/${activeRoom.id}`);
    }
    setActiveRoom(null);
    setCurrentScreen('discovery');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f0f4ff]">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <span className="mr-3 font-bold text-blue-600">{t.loading}</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center p-6 text-center overflow-hidden" dir={t.dir}>
        {/* Background Layer */}
        <div className="absolute inset-0 bg-black z-[-2]" />
        
        {/* Background Video */}
        <div className="absolute inset-0 z-[-1]">
          <video 
            autoPlay 
            loop 
            muted={videoMuted}
            playsInline
            key="login-video-v4"
            className="w-full h-full object-cover"
            style={{ opacity: 0.6 }}
          >
            <source src="https://storage.googleapis.com/firebasestorage.googleapis.com/v0/b/ais-dev-o35cuzfdcenok6pd73phb6.firebasestorage.app/o/user_uploads%2F153620087443%2Fgemini205799%40gmail.com%2Finput_file_0.mp4?alt=media&token=81358983-0599-4700-8809-5f2129e92476" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" />
        </div>

        <div className="absolute top-6 right-6 z-20 flex gap-3">
          <button 
            onClick={() => setVideoMuted(!videoMuted)}
            className="w-10 h-10 flex items-center justify-center bg-white/20 backdrop-blur-lg rounded-full text-white border border-white/30 hover:bg-white/30 transition-all shadow-lg"
            title={videoMuted ? "Unmute" : "Mute"}
          >
            {videoMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          
          <div className="relative">
            <button 
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-lg rounded-2xl shadow-lg text-sm font-bold text-white border border-white/30 hover:bg-white/30 transition-all"
            >
              <Globe className="w-4 h-4" />
              {(translations[lang] as any).name}
              <ChevronDown className={cn("w-4 h-4 transition-transform", showLangMenu && "rotate-180")} />
            </button>
            
            <AnimatePresence>
              {showLangMenu && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute top-full mt-2 right-0 w-40 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-700 overflow-hidden z-50"
                >
                  <div className="max-h-60 overflow-y-auto py-2">
                    {(Object.keys(translations) as Language[]).map((l) => (
                      <button 
                        key={l} 
                        onClick={() => {
                          setLang(l);
                          setShowLangMenu(false);
                        }}
                        className={cn(
                          "w-full px-4 py-2 text-left text-sm font-medium hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors",
                          lang === l ? "text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20" : "text-gray-600 dark:text-gray-300"
                        )}
                        style={{ textAlign: t.dir === 'rtl' ? 'right' : 'left' }}
                      >
                        {(translations[l] as any).name}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="relative z-10 flex flex-col items-center w-full max-w-md">
          {/* Logo Section */}
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative mb-4 flex items-center justify-center"
          >
            {/* Crown */}
            <div className="absolute -top-10 z-20 text-5xl drop-shadow-lg">👑</div>
            
            {/* Soundwaves Left */}
            <div className="absolute -left-20 flex items-center gap-1">
              {[0.4, 0.7, 0.5, 0.8, 0.4].map((h, i) => (
                <div key={i} className="w-1.5 bg-orange-400 rounded-full soundwave-bar" style={{ height: `${h * 40}px`, animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>

            {/* Star Icon */}
            <div className="relative w-32 h-32 flex items-center justify-center">
              <div className="absolute inset-0 bg-yellow-400 rounded-[40%] rotate-45 shadow-xl border-4 border-orange-500/30" />
              <div className="absolute inset-0 bg-yellow-400 rounded-[40%] shadow-xl border-4 border-orange-500/30" />
              <div className="relative z-10 text-6xl">😊</div>
            </div>

            {/* Soundwaves Right */}
            <div className="absolute -right-20 flex items-center gap-1">
              {[0.4, 0.8, 0.5, 0.7, 0.4].map((h, i) => (
                <div key={i} className="w-1.5 bg-orange-400 rounded-full soundwave-bar" style={{ height: `${h * 40}px`, animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>

            {/* Floating Faces */}
            <div className="absolute -top-4 -left-6 text-2xl">😄</div>
            <div className="absolute -top-4 -right-6 text-2xl">🥰</div>
            <div className="absolute top-10 -left-12 text-2xl">👨🏾‍🦱</div>
            <div className="absolute top-10 -right-12 text-2xl">👱🏻‍♂️</div>
          </motion.div>

          {/* MEZO 3D Text */}
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mezo-text-3d mb-2 flex -space-x-2"
            style={{ direction: 'ltr' }}
          >
            <span className="mezo-letter mezo-m -rotate-6" data-text="M">M</span>
            <span className="mezo-letter mezo-e" data-text="E">E</span>
            <span className="mezo-letter mezo-z" data-text="Z">Z</span>
            <span className="mezo-letter mezo-o rotate-6" data-text="O">O</span>
          </motion.div>

          {/* Subtexts */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col items-center gap-1 mb-8"
          >
            <h2 className="text-white font-bold text-xl tracking-wider drop-shadow-lg">SOCIAL AUDIO PLATFORM</h2>
            <p className="text-blue-300 text-sm font-bold tracking-widest opacity-80">PRIVACY PROTECTED</p>
          </motion.div>

          <motion.button 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            onClick={handleLogin}
            className="w-full max-w-xs py-4 bg-white text-blue-600 rounded-2xl font-bold shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3 border-2 border-white/50"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
            {t.login_google}
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className={cn("flex justify-center min-h-screen font-tajawal transition-colors duration-300", theme === 'dark' ? "bg-slate-900 dark" : "bg-slate-100")} dir={t.dir}>
        <div className="w-full max-w-[390px] bg-[var(--bg-app)] relative flex flex-col shadow-2xl overflow-hidden text-[var(--text-main)]">
          
          <AnimatePresence mode="wait">
            {currentScreen === 'discovery' && (
              <motion.div 
                key="discovery"
                initial={{ opacity: 0, x: t.dir === 'rtl' ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: t.dir === 'rtl' ? -20 : 20 }}
                className="flex-1 flex flex-col"
              >
                <header className="bg-blue-600 p-4 text-white flex justify-between items-center rounded-b-3xl shadow-lg">
                  <div className="bg-white/20 px-3 py-1 rounded-full font-bold text-sm">
                    🏅 {profile?.coins_balance.toLocaleString()} {t.coins}
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={toggleTheme}
                      className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors shadow-lg"
                      title={theme === 'light' ? t.dark_mode : t.light_mode}
                    >
                      {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                    </button>
                    <div className="relative">
                      <button 
                        onClick={() => setShowLangMenu(!showLangMenu)}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white"
                      >
                        <Globe className="w-5 h-5" />
                      </button>
                      
                      <AnimatePresence>
                        {showLangMenu && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className={cn(
                              "absolute top-full mt-2 w-40 bg-[var(--bg-card)] rounded-2xl shadow-xl border border-[var(--border-color)] overflow-hidden z-50",
                              t.dir === 'rtl' ? "left-0" : "right-0"
                            )}
                          >
                            <div className="max-h-60 overflow-y-auto py-2">
                              {(Object.keys(translations) as Language[]).map((l) => (
                                <button 
                                  key={l} 
                                  onClick={() => {
                                    setLang(l);
                                    setShowLangMenu(false);
                                  }}
                                  className={cn(
                                    "w-full px-4 py-2 text-sm font-medium hover:bg-teal-500/10 transition-colors",
                                    lang === l ? "text-teal-500 bg-teal-500/5" : "text-[var(--text-main)]"
                                  )}
                                  style={{ textAlign: t.dir === 'rtl' ? 'right' : 'left' }}
                                >
                                  {(translations[l] as any).name}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="w-10 h-10 rounded-full border-2 border-yellow-400 overflow-hidden">
                      <img src={profile?.avatar} alt="Avatar" className="w-full h-full object-cover" />
                    </div>
                  </div>
                </header>

                <div className="p-4 text-center font-fredoka text-3xl tracking-widest">
                  <span className="text-red-500">M</span>
                  <span className="text-green-500">E</span>
                  <span className="text-blue-500">Z</span>
                  <span className="text-yellow-500">O</span>
                </div>

                <div className="flex justify-between items-center px-4 py-2 bg-teal-500 text-white">
                  <div className="flex items-center gap-2">
                    <Search className="w-5 h-5" />
                    <div className="flex gap-4 text-sm font-bold">
                      <button onClick={() => setActiveTab('following')} className={cn(activeTab === 'following' && "border-b-2 border-white")}>{(t as any).following}</button>
                      <button onClick={() => setActiveTab('famous')} className={cn(activeTab === 'famous' && "border-b-2 border-white")}>{(t as any).famous}</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-white/20 px-2 py-1 rounded-full text-xs font-bold">
                    🪙 {profile?.coins_balance}
                  </div>
                </div>

                <div className="mx-4 mt-4 p-4 rounded-2xl bg-[var(--bg-card)] shadow-sm flex items-center justify-between border border-[var(--border-color)]">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-teal-500/10 rounded-2xl flex items-center justify-center text-teal-500">
                      <Plus className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold">{(t as any).create_room_banner}</h2>
                      <p className="text-[10px] text-[var(--text-muted)]">{(t as any).start_voice_journey}</p>
                    </div>
                  </div>
                  <button onClick={handleCreateRoom} className="bg-teal-500 text-white p-2 rounded-full">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <div className="px-4 mt-4 flex gap-6 text-xs font-bold text-[var(--text-muted)] border-b border-[var(--border-color)] pb-2">
                  <button 
                    onClick={() => setActiveTab('recent')}
                    className={cn(activeTab === 'recent' ? "text-teal-500 border-b-2 border-teal-500 pb-2" : "pb-2")}
                  >
                    {(t as any).recent}
                  </button>
                  <button 
                    onClick={() => setActiveTab('following')}
                    className={cn(activeTab === 'following' ? "text-teal-500 border-b-2 border-teal-500 pb-2" : "pb-2")}
                  >
                    {(t as any).following}
                  </button>
                  <button 
                    onClick={() => setActiveTab('famous')}
                    className={cn(activeTab === 'famous' ? "text-teal-500 border-b-2 border-teal-500 pb-2" : "pb-2")}
                  >
                    {(t as any).famous}
                  </button>
                </div>

                <div className="px-4 mt-4">
                  <div className="bg-[var(--bg-card)] rounded-xl shadow-sm flex items-center px-3 py-2 gap-2 border border-[var(--border-color)]">
                    <Search className="w-4 h-4 text-[var(--text-muted)]" />
                    <input 
                      type="text" 
                      placeholder={(t as any).search_placeholder}
                      className="bg-transparent border-none outline-none w-full text-xs text-[var(--text-main)]"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>

                <motion.div 
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="flex-1 flex flex-col gap-3 px-4 mt-4 pb-24 overflow-y-auto"
                >
                  {filteredRooms.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-gray-500 text-sm mb-4">{t.no_rooms}</p>
                      <button onClick={seedRooms} className="text-xs text-teal-600 font-bold underline">Seed 10 Sample Rooms</button>
                    </div>
                  ) : (
                    filteredRooms.map((room) => (
                      <motion.div 
                        key={room.id}
                        variants={itemVariants}
                        onClick={() => joinRoom(room)}
                        className={cn(
                          "bg-[var(--bg-card)] p-3 rounded-2xl shadow-sm flex items-center gap-4 cursor-pointer hover:bg-teal-500/5 transition-colors border border-[var(--border-color)] relative overflow-hidden",
                          room.memberCount > 10 && "ring-2 ring-teal-400/30 shadow-[0_0_15px_rgba(20,184,166,0.2)]"
                        )}
                      >
                        {room.memberCount > 10 && (
                          <motion.div 
                            animate={{ opacity: [0.8, 1, 0.8] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="absolute top-0 right-0 bg-teal-500 text-white text-[8px] px-2 py-0.5 rounded-bl-lg font-bold uppercase tracking-wider"
                          >
                            Hot 🔥
                          </motion.div>
                        )}
                        <div className="relative w-16 h-16 flex-shrink-0">
                          <img 
                            src={(room as any).avatar || `https://picsum.photos/seed/${room.id}/200/200`} 
                            className="w-full h-full rounded-xl object-cover border-2 border-purple-200/30" 
                            alt="room" 
                          />
                          <div className="absolute bottom-1 right-1 bg-black/60 text-white rounded px-1 text-[8px] font-bold flex items-center gap-0.5">
                            <span className="text-blue-400">{(room as any).level || 1}</span>
                            <span className="text-red-400">{(room as any).country || 'TR'}</span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm truncate">{(room as any).title}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex items-center gap-1 text-[10px] text-teal-500 font-bold">
                              <span className="w-1.5 h-3 bg-teal-500 rounded-full animate-pulse"></span>
                              {room.memberCount}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] truncate">{(room as any).desc || 'Welcome to our room!'}</div>
                          </div>
                        </div>
                        <div className="flex -space-x-2">
                          {[1, 2, 3].map(i => (
                            <img key={i} src={`https://picsum.photos/seed/u${i}${room.id}/40/40`} className="w-6 h-6 rounded-full border-2 border-[var(--bg-card)]" alt="user" />
                          ))}
                        </div>
                      </motion.div>
                    ))
                  )}
                </motion.div>

                <button 
                  onClick={handleCreateRoom}
                  className={cn("absolute bottom-20 w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white text-3xl shadow-2xl hover:rotate-90 transition-transform", t.dir === 'rtl' ? "left-6" : "right-6")}
                >
                  <Plus />
                </button>
              </motion.div>
            )}

            {currentScreen === 'room' && activeRoom && (
              <VoiceRoom 
                room={activeRoom} 
                user={user} 
                profile={profile} 
                onLeave={leaveRoom} 
                t={t}
              />
            )}

            {currentScreen === 'profile' && profile && (
              <ProfileView 
                profile={profile} 
                onBack={() => setCurrentScreen('discovery')} 
                t={t} 
                theme={theme}
                toggleTheme={toggleTheme}
              />
            )}

            {currentScreen === 'admin' && user?.email === 'gemini205799@gmail.com' && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex-1 flex flex-col p-4 pb-24 overflow-y-auto"
              >
                <h2 className="text-2xl font-bold text-teal-500 mb-6">{(t as any).admin_title}</h2>
                <div className="flex flex-col gap-4">
                  {allUsers.map(u => (
                    <AdminUserRow key={u.uid} u={u} t={t} />
                  ))}
                </div>
              </motion.div>
            )}

            {currentScreen === 'messages' && (
              <motion.div 
                initial={{ opacity: 0, x: t.dir === 'rtl' ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex-1 flex flex-col p-4 pb-24 overflow-y-auto"
              >
                <h2 className="text-2xl font-bold text-teal-500 mb-6">{(t as any).recent}</h2>
                <div className="flex flex-col items-center justify-center flex-1 text-[var(--text-muted)]">
                  <MessageCircle className="w-16 h-16 mb-4 opacity-20" />
                  <p>{(t as any).no_messages || "No recent messages"}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {currentScreen !== 'room' && (
            <nav className="absolute bottom-0 w-full bg-[var(--bg-card)] p-3 flex justify-around items-center rounded-t-[40px] shadow-[0_-4px_20px_rgba(0,0,0,0.2)] border-t border-[var(--border-color)] z-50">
              <div 
                className={cn(
                  "flex flex-col items-center gap-1 cursor-pointer transition-all duration-300", 
                  currentScreen === 'discovery' ? "text-teal-500 scale-110" : "text-[var(--text-muted)] hover:text-teal-400"
                )} 
                onClick={() => setCurrentScreen('discovery')}
              >
                <Home className={cn("transition-all", currentScreen === 'discovery' ? "w-7 h-7" : "w-6 h-6")} />
                <span className={cn("text-[10px] transition-all", currentScreen === 'discovery' ? "font-black" : "font-bold")}>{t.home}</span>
              </div>

              <div 
                className={cn(
                  "flex flex-col items-center gap-1 cursor-pointer transition-all duration-300", 
                  currentScreen === 'messages' ? "text-teal-500 scale-110" : "text-[var(--text-muted)] hover:text-teal-400"
                )} 
                onClick={() => setCurrentScreen('messages')}
              >
                <MessageCircle className={cn("transition-all", currentScreen === 'messages' ? "w-7 h-7" : "w-6 h-6")} />
                <span className={cn("text-[10px] transition-all", currentScreen === 'messages' ? "font-black" : "font-bold")}>{(t as any).recent}</span>
              </div>

              {user?.email === 'gemini205799@gmail.com' && (
                <div 
                  className={cn(
                    "flex flex-col items-center gap-1 cursor-pointer transition-all duration-300", 
                    currentScreen === 'admin' ? "text-teal-500 scale-110" : "text-[var(--text-muted)] hover:text-teal-400"
                  )} 
                  onClick={() => setCurrentScreen('admin')}
                >
                  <ShieldCheck className={cn("transition-all", currentScreen === 'admin' ? "w-7 h-7" : "w-6 h-6")} />
                  <span className={cn("text-[10px] transition-all", currentScreen === 'admin' ? "font-black" : "font-bold")}>Admin</span>
                </div>
              )}

              <div 
                className={cn(
                  "flex flex-col items-center gap-1 cursor-pointer transition-all duration-300", 
                  currentScreen === 'profile' ? "text-teal-500 scale-110" : "text-[var(--text-muted)] hover:text-teal-400"
                )} 
                onClick={() => setCurrentScreen('profile')}
              >
                <UserIcon className={cn("transition-all", currentScreen === 'profile' ? "w-7 h-7" : "w-6 h-6")} />
                <span className={cn("text-[10px] transition-all", currentScreen === 'profile' ? "font-black" : "font-bold")}>{t.profile}</span>
              </div>
            </nav>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

function NavBtn({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center gap-1 transition-colors", active ? "text-blue-600" : "text-gray-400")}>
      <div className="text-2xl">{icon}</div>
      <span className="text-[10px] font-bold">{label}</span>
    </button>
  );
}

// --- Room Component ---

function VoiceRoom({ room, user, profile, onLeave, t }: { room: Room, user: FirebaseUser, profile: UserProfile | null, onLeave: () => void, t: any }) {
  const [isMuted, setIsMuted] = useState(true);
  const [isTalking, setIsTalking] = useState(false);
  const [agoraClient, setAgoraClient] = useState<IAgoraRTCClient | null>(null);
  const [localAudioTrack, setLocalAudioTrack] = useState<ILocalAudioTrack | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<any[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});
  const [selectedUserForGift, setSelectedUserForGift] = useState<UserProfile | null>(null);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [activeGiftAnimation, setActiveGiftAnimation] = useState<{ gift: any, sender: string, receiver: string } | null>(null);
  const [agoraError, setAgoraError] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);

  const gifts = [
    { id: 'rose', icon: '🌹', price: 10, name: 'Rose' },
    { id: 'diamond', icon: '💎', price: 50, name: 'Diamond' },
    { id: 'rocket', icon: '🚀', price: 100, name: 'Rocket' },
    { id: 'crown', icon: '👑', price: 500, name: 'Crown' },
    { id: 'lion', icon: '🦁', price: 1000, name: 'Lion' }
  ];

  const handleSendGift = async (gift: any) => {
    if (!profile || !selectedUserForGift) return;
    if (profile.coins_balance < gift.price) {
      alert(t.insufficient_coins || "Insufficient coins!");
      return;
    }

    try {
      // 1. Create transaction
      await addDoc(collection(db, 'transactions'), {
        senderId: user.uid,
        receiverId: selectedUserForGift.uid,
        giftId: gift.id,
        amount: gift.price,
        roomId: room.id,
        timestamp: serverTimestamp()
      });

      // 2. Update sender balance
      await updateDoc(doc(db, 'users', user.uid), {
        coins_balance: increment(-gift.price)
      });

      // 3. Update receiver balance (optional, maybe they get a percentage)
      await updateDoc(doc(db, 'users', selectedUserForGift.uid), {
        coins_balance: increment(gift.price)
      });

      alert(`Sent ${gift.icon} to ${selectedUserForGift.name}!`);
      setShowGiftModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'transactions');
    }
  };

  const openGiftModal = (uProfile: UserProfile) => {
    if (uProfile.uid === user.uid) return; // Can't gift yourself
    setSelectedUserForGift(uProfile);
    setShowGiftModal(true);
  };

  // Fetch profiles for speakers and remote users
  useEffect(() => {
    const uidsToFetch = [...new Set([...room.activeSpeakers, ...remoteUsers.map(u => String(u.uid))])];
    const missingUids = uidsToFetch.filter(uid => !userProfiles[uid] && uid !== user.uid);

    if (missingUids.length === 0) return;

    // Fetch missing profiles
    missingUids.forEach(async (uid) => {
      try {
        const docRef = doc(db, 'users', uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setUserProfiles(prev => ({ ...prev, [uid]: docSnap.data() as UserProfile }));
        }
      } catch (err) {
        console.error("Error fetching profile for room:", err);
      }
    });
  }, [room.activeSpeakers, remoteUsers, userProfiles, user.uid]);

  // Listen for gifts in this room
  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('roomId', '==', room.id),
      orderBy('timestamp', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          // Only show if it's very recent (within last 10 seconds) to avoid showing old ones on join
          const now = Date.now();
          const timestamp = data.timestamp?.toMillis() || now;
          if (now - timestamp < 10000) {
            const gift = gifts.find(g => g.id === data.giftId);
            const sender = userProfiles[data.senderId]?.name || (data.senderId === user.uid ? profile?.name : 'Someone');
            const receiver = userProfiles[data.receiverId]?.name || (data.receiverId === user.uid ? profile?.name : 'Someone');
            
            if (gift) {
              setActiveGiftAnimation({ gift, sender: sender || 'User', receiver: receiver || 'User' });
              setTimeout(() => setActiveGiftAnimation(null), 4000);
            }
          }
        }
      });
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'transactions');
    });

    return () => unsubscribe();
  }, [room.id, userProfiles, profile, user.uid]);

  // Agora Logic
  useEffect(() => {
    let mounted = true;
    if (!AGORA_APP_ID) {
      console.warn("Agora App ID is missing. Audio will not work.");
      return;
    }

    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    setAgoraClient(client);

    const initAgora = async () => {
      try {
        // Join the channel
        // Note: Passing null as token. If your Agora project has "App Certificate" enabled, 
        // this will fail with CAN_NOT_GET_GATEWAY_SERVER. 
        // Use a project in "Testing Mode" (no certificate) for this demo.
        await client.join(AGORA_APP_ID, room.id, null, user.uid);
        if (mounted) setIsJoined(true);
        
        if (!mounted) {
          await client.leave();
          return;
        }

        // Handle remote users joining/leaving
        client.on('user-published', async (remoteUser, mediaType) => {
          try {
            await client.subscribe(remoteUser, mediaType);
            if (mediaType === 'audio') {
              remoteUser.audioTrack?.play();
              setRemoteUsers(prev => {
                if (prev.find(u => u.uid === remoteUser.uid)) return prev;
                return [...prev, remoteUser];
              });
            }
          } catch (err) {
            console.error("Error subscribing to remote user:", err);
          }
        });

        client.on('user-unpublished', (remoteUser) => {
          setRemoteUsers(prev => prev.filter(u => u.uid !== remoteUser.uid));
        });

      } catch (error: any) {
        if (mounted) {
          console.error("Agora initialization failed:", error);
          if (error.code === 'OPERATION_ABORTED') {
            // Ignore aborted operations (usually during cleanup/remount)
            return;
          }
          if (error.message?.includes('CAN_NOT_GET_GATEWAY_SERVER') || error.message?.includes('dynamic use static key')) {
            setAgoraError("CERTIFICATE_ENABLED");
            console.error("CRITICAL: Your Agora project likely has 'App Certificate' enabled. Please disable it in the Agora Console (Testing Mode) to use App ID without a token.");
          } else {
            setAgoraError(error.message || "Unknown Agora Error");
          }
        }
      }
    };

    initAgora();

    return () => {
      mounted = false;
      const leave = async () => {
        if (localAudioTrack) {
          localAudioTrack.stop();
          localAudioTrack.close();
        }
        await client.leave();
      };
      leave();
    };
  }, [room.id, user.uid]);

  const toggleMic = async () => {
    if (!agoraClient || !isJoined) {
      if (agoraError === "CERTIFICATE_ENABLED") {
        alert("لا يمكن فتح الميكروفون بسبب خطأ في إعدادات Agora (App Certificate).");
      } else if (!isJoined) {
        alert("يرجى الانتظار حتى يتم الاتصال بالغرفة...");
      }
      return;
    }

    try {
      if (isMuted) {
        // Unmute: Create and publish local track
        const track = await AgoraRTC.createMicrophoneAudioTrack();
        await agoraClient.publish(track);
        setLocalAudioTrack(track);
        setIsMuted(false);
        setIsTalking(true);
      } else {
        // Mute: Unpublish and close track
        if (localAudioTrack) {
          await agoraClient.unpublish(localAudioTrack);
          localAudioTrack.stop();
          localAudioTrack.close();
          setLocalAudioTrack(null);
        }
        setIsMuted(true);
        setIsTalking(false);
      }
    } catch (error: any) {
      console.error("Mic toggle failed:", error);
      if (error.message?.includes('PERMISSION_DENIED')) {
        alert("يرجى السماح بالوصول إلى الميكروفون من إعدادات المتصفح لتتمكن من التحدث.");
      }
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="flex-1 flex flex-col h-full bg-[var(--bg-app)]"
    >
      <header className="bg-[var(--bg-card)] p-4 flex flex-col gap-2 shadow-sm border-b border-[var(--border-color)]">
        <div className="flex justify-between items-center">
          <button onClick={onLeave} className="text-2xl text-[var(--text-main)]">{t.dir === 'rtl' ? '←' : '→'}</button>
          <div className="font-bold text-lg flex items-center gap-2 text-[var(--text-main)]">
            {room.title} <Lock className="w-4 h-4 text-[var(--text-muted)]" />
          </div>
          <div className="w-6"></div>
        </div>
        <div className="bg-teal-500/10 px-3 py-1 rounded-full text-xs text-teal-500 self-start font-bold">
          #{room.topic === 'Music' || room.topic === 'موسيقى' ? t.music : t.general}
        </div>
      </header>

      <div className="flex-1 p-6">
        {agoraError === "CERTIFICATE_ENABLED" && user.email === 'gemini205799@gmail.com' && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs leading-relaxed">
            <p className="font-bold mb-1">⚠️ خطأ في إعدادات Agora (للمطور فقط):</p>
            <p>مشروع Agora الخاص بك يتطلب "Token". يرجى تعطيل "App Certificate" في لوحة تحكم Agora (وضع الاختبار) لاستخدام App ID بدون Token.</p>
          </div>
        )}
        <div className="text-sm text-[var(--text-muted)] mb-6 font-medium uppercase tracking-wider">{t.speakers}</div>
        <div className="grid grid-cols-3 gap-6 justify-items-center">
          {/* Owner/Host */}
          <div className="flex flex-col items-center gap-2">
            <div 
              onClick={() => profile && openGiftModal(profile)}
              className={cn("relative w-20 h-20 rounded-full bg-[var(--bg-card)] flex items-center justify-center p-1 cursor-pointer", isTalking && "ring-4 ring-green-500 animate-pulse")}
            >
              <img src={profile?.avatar} alt="Host" className="w-full h-full rounded-full object-cover" />
              {isMuted && <div className={cn("absolute bottom-0 bg-[var(--bg-card)] p-1 rounded-full shadow-md border border-[var(--border-color)]", t.dir === 'rtl' ? "right-0" : "left-0")}><MicOff className="w-4 h-4 text-red-500" /></div>}
            </div>
            <span className="text-sm font-bold text-[var(--text-main)]">{profile?.name} 🎙️</span>
          </div>

          {/* Other Seats */}
          {[1, 2, 3, 4, 5].map((i) => {
            const speakerUid = room.activeSpeakers[i]; // Host is at 0
            const speakerProfile = speakerUid ? userProfiles[speakerUid] : null;

            return (
              <div key={i} className="flex flex-col items-center gap-2">
                {speakerProfile ? (
                  <div 
                    onClick={() => openGiftModal(speakerProfile)}
                    className="relative w-16 h-16 rounded-full bg-[var(--bg-card)] flex items-center justify-center p-1 cursor-pointer"
                  >
                    <img src={speakerProfile.avatar} alt="Speaker" className="w-full h-full rounded-full object-cover" />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-full border-2 border-dashed border-[var(--border-color)] flex items-center justify-center text-[var(--text-muted)] text-2xl cursor-pointer hover:bg-teal-500/5 transition-colors">
                    +
                  </div>
                )}
                <span className="text-xs text-[var(--text-muted)] truncate w-16 text-center">
                  {speakerProfile ? speakerProfile.name : t.join}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-10">
          <div className="text-sm text-[var(--text-muted)] mb-4 font-medium uppercase tracking-wider">{t.listeners} ({remoteUsers.length + 1})</div>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <img src={profile?.avatar} className="w-10 h-10 rounded-full border-2 border-teal-500" alt="me" />
              <span className="text-[8px] text-teal-500 font-bold uppercase">Me</span>
            </div>
            {remoteUsers.map((u) => {
              const uProfile = userProfiles[String(u.uid)];
              return (
                <div 
                  key={u.uid} 
                  onClick={() => uProfile && openGiftModal(uProfile)}
                  className="flex flex-col items-center gap-1 flex-shrink-0 cursor-pointer"
                >
                  {uProfile ? (
                    <img src={uProfile.avatar} className="w-10 h-10 rounded-full border border-[var(--border-color)]" alt="listener" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-teal-500/10 flex items-center justify-center text-[10px] font-bold text-teal-500 border border-teal-500/20">
                      ?
                    </div>
                  )}
                  <span className="text-[8px] text-[var(--text-muted)] truncate w-10 text-center">
                    {uProfile ? uProfile.name : '...'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] p-4 rounded-t-[40px] shadow-2xl border-t border-[var(--border-color)]">
        <div className="text-sm font-bold mb-4 flex items-center gap-2 text-[var(--text-main)]">{t.gifts}</div>
        <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
          {gifts.map((gift, i) => (
            <div key={i} className="flex flex-col items-center gap-1 min-w-[60px]">
              <div className="w-14 h-14 bg-[var(--bg-app)] rounded-2xl border border-[var(--border-color)] flex items-center justify-center text-2xl shadow-sm">
                {gift.icon}
              </div>
              <span className="text-xs font-bold text-yellow-500">{gift.price}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center pt-2">
          <button 
            onClick={toggleMic}
            className={cn("flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shadow-lg", isMuted ? "bg-red-500 text-white" : "bg-teal-500 text-white")}
          >
            {isMuted ? <MicOff /> : <Mic />}
            {isMuted ? t.talk : t.muted}
          </button>
          <button 
            onClick={() => {
              const ownerProfile = userProfiles[room.ownerId];
              if (ownerProfile) {
                openGiftModal(ownerProfile);
              } else {
                alert("Select a user to send a gift! 🎁");
              }
            }}
            className="p-3 bg-orange-500 text-white rounded-2xl shadow-lg hover:scale-110 transition-transform"
          >
            <Gift />
          </button>
          <button onClick={onLeave} className="px-6 py-3 bg-red-500/10 text-red-500 rounded-2xl font-bold border border-red-500/20">{t.exit}</button>
        </div>
      </div>

      <AnimatePresence>
        {activeGiftAnimation && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center overflow-hidden"
          >
            {/* Background Glow */}
            <motion.div 
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 1.5, 1.2], opacity: [0, 0.6, 0.4] }}
              transition={{ duration: 1 }}
              className="absolute w-[300px] h-[300px] bg-yellow-400 rounded-full blur-[80px]"
            />

            <div className="relative flex flex-col items-center">
              {/* Gift Icon */}
              <motion.div
                initial={{ scale: 0, rotate: -45 }}
                animate={{ 
                  scale: [0, 1.5, 1], 
                  rotate: [0, 360],
                  y: [0, -20, 0]
                }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                className="text-8xl mb-4 drop-shadow-[0_0_20px_rgba(255,255,255,0.8)]"
              >
                {activeGiftAnimation.gift.icon}
              </motion.div>

              {/* Text Info */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-center bg-black/60 backdrop-blur-md px-6 py-3 rounded-full border border-white/20 shadow-2xl"
              >
                <p className="text-white font-bold text-lg">
                  <span className="text-yellow-400">{activeGiftAnimation.sender}</span>
                  <span className="mx-2 text-white/80">sent</span>
                  <span className="text-teal-400">{activeGiftAnimation.gift.name}</span>
                </p>
                <p className="text-white/60 text-xs mt-1">to {activeGiftAnimation.receiver}</p>
              </motion.div>

              {/* Particles/Confetti */}
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ x: 0, y: 0, opacity: 1 }}
                  animate={{ 
                    x: (Math.random() - 0.5) * 400, 
                    y: (Math.random() - 0.5) * 400,
                    opacity: 0,
                    scale: 0
                  }}
                  transition={{ duration: 2, delay: 0.2 }}
                  className="absolute text-xl"
                >
                  ✨
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGiftModal && selectedUserForGift && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="w-full max-w-[390px] bg-[var(--bg-card)] rounded-t-[40px] p-6 shadow-2xl border-t border-[var(--border-color)]"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <img src={selectedUserForGift.avatar} className="w-12 h-12 rounded-full border-2 border-teal-500" alt="receiver" />
                  <div>
                    <h3 className="font-bold text-[var(--text-main)]">{(t as any).send_gift_to} {selectedUserForGift.name}</h3>
                    <p className="text-[10px] text-[var(--text-muted)]">ID: {selectedUserForGift.uid.slice(0, 8)}</p>
                  </div>
                </div>
                <button onClick={() => setShowGiftModal(false)} className="text-[var(--text-muted)] text-xl">✕</button>
              </div>

              <div className="grid grid-cols-4 gap-4 mb-8">
                {gifts.map((gift) => (
                  <button 
                    key={gift.id}
                    onClick={() => handleSendGift(gift)}
                    className="flex flex-col items-center gap-2 p-2 rounded-2xl bg-[var(--bg-app)] border border-[var(--border-color)] hover:border-teal-500 transition-colors"
                  >
                    <span className="text-3xl">{gift.icon}</span>
                    <span className="text-[10px] font-bold text-yellow-500">{gift.price}</span>
                  </button>
                ))}
              </div>

              <div className="flex justify-between items-center bg-teal-500/5 p-4 rounded-2xl border border-teal-500/10">
                <span className="text-xs font-bold text-[var(--text-muted)]">{(t as any).your_balance}:</span>
                <span className="text-sm font-bold text-teal-500">🪙 {profile?.coins_balance.toLocaleString()}</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// --- Profile View ---

function ProfileView({ 
  profile, 
  onBack, 
  t, 
  theme, 
  toggleTheme 
}: { 
  profile: UserProfile, 
  onBack: () => void, 
  t: any,
  theme: 'light' | 'dark',
  toggleTheme: () => void
}) {
  const menuItems = [
    { icon: <Wallet className="w-5 h-5 text-teal-500" />, label: (t as any).wallet, color: 'bg-teal-50' },
    { icon: theme === 'light' ? <Moon className="w-5 h-5 text-indigo-500" /> : <Sun className="w-5 h-5 text-yellow-500" />, label: theme === 'light' ? (t as any).dark_mode : (t as any).light_mode, color: 'bg-indigo-50', onClick: toggleTheme },
    { icon: <Users className="w-5 h-5 text-orange-500" />, label: (t as any).invite_friends, color: 'bg-orange-50' },
    { icon: <ShieldCheck className="w-5 h-5 text-black" />, label: (t as any).svip, color: 'bg-gray-100' },
    { icon: <Award className="w-5 h-5 text-blue-500" />, label: (t as any).medal, color: 'bg-blue-50' },
    { icon: <Star className="w-5 h-5 text-orange-400" />, label: (t as any).level, color: 'bg-orange-50' },
    { icon: <Heart className="w-5 h-5 text-pink-500" />, label: (t as any).cp_friend, color: 'bg-pink-50' },
    { icon: <Users className="w-5 h-5 text-orange-300" />, label: (t as any).family, color: 'bg-orange-50' },
    { icon: <ShoppingBag className="w-5 h-5 text-purple-500" />, label: (t as any).store, color: 'bg-purple-50' },
    { icon: <Shirt className="w-5 h-5 text-blue-400" />, label: (t as any).my_tools, color: 'bg-blue-50' },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, x: t.dir === 'rtl' ? -20 : 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: t.dir === 'rtl' ? 20 : -20 }}
      className="flex-1 flex flex-col bg-[var(--bg-app)] h-full overflow-y-auto pb-24"
    >
      <div className="bg-gradient-to-b from-teal-500 to-teal-600 p-6 pt-12 text-white relative shadow-lg">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{profile.name}</h2>
            <p className="text-xs opacity-80">ID: {profile.displayId || profile.uid.slice(0, 8)} 📋</p>
          </div>
          <div className="relative">
            <img src={profile.avatar} className="w-20 h-20 rounded-full border-4 border-white/20 shadow-xl" alt="avatar" />
            <div className="absolute -bottom-2 -right-2 bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-white">
              LV.{profile.level}
            </div>
          </div>
        </div>

        <div className="flex justify-around mt-8 text-center">
          <div>
            <div className="text-lg font-bold">1</div>
            <div className="text-[10px] opacity-80">{(t as any).visitors}</div>
          </div>
          <div>
            <div className="text-lg font-bold">9</div>
            <div className="text-[10px] opacity-80">{(t as any).following_count}</div>
          </div>
          <div>
            <div className="text-lg font-bold">5</div>
            <div className="text-[10px] opacity-80">{(t as any).followers}</div>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-4">
        <div className="bg-[var(--bg-card)] rounded-3xl shadow-xl p-2 border border-[var(--border-color)]">
          {menuItems.map((item, i) => (
            <div 
              key={i} 
              onClick={item.onClick || (() => alert(`${item.label} Coming Soon! 🚀`))}
              className="flex items-center justify-between p-4 hover:bg-teal-500/5 cursor-pointer border-b border-[var(--border-color)] last:border-0 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-xl", item.color, "dark:bg-opacity-10")}>
                  {item.icon}
                </div>
                <span className="text-sm font-medium text-[var(--text-main)]">{item.label}</span>
              </div>
              <ChevronRight className={cn("w-4 h-4 text-[var(--text-muted)]", t.dir === 'rtl' && "rotate-180")} />
            </div>
          ))}
        </div>

        <div className="mt-6 bg-[var(--bg-card)] rounded-3xl shadow-xl p-6 border border-[var(--border-color)]">
          <h3 className="text-lg font-bold text-teal-500 mb-4 flex items-center gap-2">
            <Info className="w-5 h-5" />
            {(t as any).about}
          </h3>
          <div className="text-sm text-[var(--text-main)] space-y-4 whitespace-pre-line leading-relaxed opacity-90">
            {t.dir === 'rtl' ? (
              <>
                <p className="font-bold text-teal-600">برنامج MEZO ميزو</p>
                <p>عبارة عن منصة اجتماعية صوتية عبر الإنترنت. في MEZO، يمكنك التعرف بسرعة على أصدقاء جدد يتحدثون نفس لغتك في منطقتك، والعثور على أصدقاء مثيرين للاهتمام من خلال الدردشة الصوتية. في MEZO، يمكنك دعوة أصدقائك للحضور وإقامة الحفلات كل يوم وتصبح نجمًا مشهورًا.</p>
                
                <p className="font-bold text-teal-600 mt-4">[الدردشة الصوتية]</p>
                <p>سوف يعقد MEZO العديد من الغرف ذات السمات المميزة كل يوم، مثل تشكيل الـ CP وغرف الدردشة والغناء وأنواع أخرى من غرف السمات. كن مكان الراحة الأكثر راحة في وقت فراغك واشعر بسحر الحفلات.</p>
                
                <p className="font-bold text-teal-600 mt-4">[شارك الحياة]</p>
                <p>لقد خلق MEZO جوًا اجتماعيًا مريحًا وممتعًا، حيث يمكنك مشاركة حياتك مع أصدقائك الجدد، والعثور على أصدقاء جدد عبر الدردشة الصوتية عبر الإنترنت للتقرب من بعضكم البعض، والاستماع إلى صوتك.</p>
                
                <p className="font-bold text-teal-600 mt-4">[حماية الخصوصية]</p>
                <p>في MEZO، سنحمي خصوصية المستخدمين بشكل صارم من التسرب ونخلق بيئة آمنة ومريحة للغاية.</p>
              </>
            ) : (
              <>
                <p className="font-bold text-teal-600">MEZO App</p>
                <p>MEZO is an online social voice platform. On MEZO, you can quickly meet new friends who speak your language in your area, and find interesting friends through voice chat. On MEZO, you can invite your friends to come and hold parties every day and become a famous star.</p>
                
                <p className="font-bold text-teal-600 mt-4">[Voice Chat]</p>
                <p>MEZO will hold many themed rooms every day, such as CP formation, chat rooms, singing, and other types of themed rooms. Be the most comfortable resting place in your spare time and feel the magic of parties.</p>
                
                <p className="font-bold text-teal-600 mt-4">[Share Life]</p>
                <p>MEZO has created a relaxed and enjoyable social atmosphere where you can share your life with your new friends, find new friends via online voice chat to get closer to each other, and listen to your voice.</p>
                
                <p className="font-bold text-teal-600 mt-4">[Privacy Protection]</p>
                <p>At MEZO, we will strictly protect users' privacy from leakage and create a very safe and comfortable environment.</p>
              </>
            )}
          </div>
        </div>

        <button 
          onClick={() => signOut(auth)}
          className="w-full mt-6 mb-4 p-4 bg-[var(--bg-card)] text-red-500 font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2 border border-[var(--border-color)] hover:bg-red-500/5 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          {t.logout}
        </button>
      </div>
    </motion.div>
  );
}

function StatItem({ value, label }: { value: string, label: string }) {
  return (
    <div className="text-center">
      <span className="block text-xl font-bold">{value}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

function Badge({ icon, color }: { icon: React.ReactNode, color: string }) {
  return (
    <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-md", color)}>
      {icon}
    </div>
  );
}

function DetailRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex justify-between items-center border-bottom border-gray-50 pb-2">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
