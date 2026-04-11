/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Fuel, Route, CircleDollarSign, Calendar, Info, RefreshCcw, Navigation, StopCircle, PlayCircle, AlertTriangle, Save, Trash2, History as HistoryIcon } from 'lucide-react';

// Safe localStorage helper
const storage = {
  get: (key: string, fallback: string) => {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // Ignore
    }
  },
  clear: () => {
    try {
      localStorage.clear();
    } catch (e) {
      // Ignore
    }
  }
};

interface HistoryEntry {
  id: string;
  date: string;
  distance: number;
  fuel: number;
  cost: number;
}

// Haversine formula to calculate distance between two points in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export default function App() {
  const [distance, setDistance] = useState<string>(() => storage.get('fuelwise_distance', '20'));
  const [efficiency, setEfficiency] = useState<string>(() => storage.get('fuelwise_efficiency', '15'));
  const [price, setPrice] = useState<string>(() => storage.get('fuelwise_price', '370'));
  
  // Live tracking states
  const [isTracking, setIsTracking] = useState(() => storage.get('fuelwise_isTracking', 'false') === 'true');
  const [liveDistance, setLiveDistance] = useState(() => parseFloat(storage.get('fuelwise_liveDistance', '0')));
  const lastPosition = useRef<{ lat: number; lon: number; timestamp: number } | null>(null);
  const watchId = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    const saved = storage.get('fuelwise_history', '[]');
    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  });

  const [results, setResults] = useState({
    dailyFuel: 0,
    dailyCost: 0,
    monthlyCost: 0,
  });

  // Persist settings
  useEffect(() => {
    storage.set('fuelwise_distance', distance);
    storage.set('fuelwise_efficiency', efficiency);
    storage.set('fuelwise_price', price);
  }, [distance, efficiency, price]);

  // Persist tracking state
  useEffect(() => {
    storage.set('fuelwise_isTracking', isTracking.toString());
    storage.set('fuelwise_liveDistance', liveDistance.toString());
  }, [isTracking, liveDistance]);

  // Persist history
  useEffect(() => {
    storage.set('fuelwise_history', JSON.stringify(history));
  }, [history]);

  // Handle calculations
  useEffect(() => {
    const d = isTracking ? liveDistance : (parseFloat(distance) || 0);
    const e = parseFloat(efficiency) || 0;
    const p = parseFloat(price) || 0;

    if (e > 0) {
      const dailyFuel = d / e;
      const dailyCost = dailyFuel * p;
      const monthlyCost = dailyCost * 30;

      setResults({
        dailyFuel,
        dailyCost,
        monthlyCost,
      });
    } else {
      setResults({
        dailyFuel: 0,
        dailyCost: 0,
        monthlyCost: 0,
      });
    }
  }, [distance, efficiency, price, liveDistance, isTracking]);

  // Resume tracking on mount if it was active
  useEffect(() => {
    if (isTracking && !watchId.current) {
      startTracking();
    }
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, []);

  const startTracking = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    if ('wakeLock' in navigator) {
      (navigator as any).wakeLock.request('screen').catch((err: any) => console.error(err));
    }

    if (audioRef.current) {
      audioRef.current.play().catch(e => console.log("Audio play blocked", e));
    }

    setIsTracking(true);
    lastPosition.current = null;

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const timestamp = position.timestamp;
        
        // Filter out low accuracy points (stricter: 50m)
        if (accuracy > 50) return;

        if (lastPosition.current) {
          const dist = calculateDistance(
            lastPosition.current.lat,
            lastPosition.current.lon,
            latitude,
            longitude
          );
          
          const timeDiffHours = (timestamp - lastPosition.current.timestamp) / (1000 * 60 * 60);
          const speed = timeDiffHours > 0 ? dist / timeDiffHours : 0;

          // NOISE FILTERING LOGIC:
          // 1. Ignore if speed is less than 2 km/h (likely stationary noise)
          // 2. Ignore if distance is too small relative to accuracy
          // 3. Ignore if speed is physically impossible (> 200 km/h)
          
          const isSignificantMovement = dist > 0.01; // At least 10 meters
          const isRealisticSpeed = speed > 2 && speed < 200;

          if (isSignificantMovement && isRealisticSpeed) {
            setLiveDistance(prev => {
              const newDist = prev + dist;
              storage.set('fuelwise_liveDistance', newDist.toString());
              return newDist;
            });
            lastPosition.current = { lat: latitude, lon: longitude, timestamp };
          }
        } else {
          lastPosition.current = { lat: latitude, lon: longitude, timestamp };
        }
      },
      (error) => console.error("Error tracking position:", error),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  };

  const stopTracking = () => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsTracking(false);
    setDistance(liveDistance.toFixed(2));
  };

  const toggleTracking = () => {
    if (isTracking) {
      stopTracking();
    } else {
      setLiveDistance(0);
      startTracking();
    }
  };

  const saveToHistory = () => {
    const d = isTracking ? liveDistance : parseFloat(distance);
    if (!d || d <= 0) {
      alert("කරුණාකර දුර ප්‍රමාණයක් ඇතුළත් කරන්න.");
      return;
    }

    const newEntry: HistoryEntry = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString('si-LK', { year: 'numeric', month: 'short', day: 'numeric' }),
      distance: d,
      fuel: results.dailyFuel,
      cost: results.dailyCost,
    };

    setHistory(prev => [newEntry, ...prev]);
    if (isTracking) stopTracking();
    setLiveDistance(0);
    setDistance('0');
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearHistory = () => {
    if (window.confirm("සම්පූර්ණ ඉතිහාසයම මකා දැමීමට ඔබට අවශ්‍යද?")) {
      setHistory([]);
    }
  };

  const reset = () => {
    if (window.confirm("ඔබට සියල්ල නැවත සැකසීමට (Reset) අවශ්‍යද?")) {
      setDistance('20');
      setEfficiency('15');
      setPrice('370');
      setLiveDistance(0);
      if (isTracking) stopTracking();
      storage.clear();
      setHistory([]);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#1a1a1a] font-sans selection:bg-[#5A5A40] selection:text-white pb-20">
      <audio ref={audioRef} loop src="data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=" />

      <div className="max-w-md mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center justify-center p-3 bg-[#5A5A40] text-white rounded-2xl mb-4 shadow-lg shadow-[#5A5A40]/20"
          >
            <Fuel size={28} />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-3xl font-bold tracking-tight mb-2"
          >
            FuelWise
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-[#5A5A40] font-medium"
          >
            ඉන්ධන පිරිවැය ගණකය
          </motion.p>
        </header>

        {/* Live Tracking Banner */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mb-6 p-4 rounded-3xl flex items-center justify-between transition-colors ${
            isTracking ? 'bg-red-50 border border-red-100 shadow-lg shadow-red-100' : 'bg-[#5A5A40]/5 border border-[#5A5A40]/10'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isTracking ? 'bg-red-500 text-white animate-pulse' : 'bg-[#5A5A40] text-white'}`}>
              <Navigation size={18} />
            </div>
            <div>
              <p className="text-xs font-bold text-[#5A5A40] uppercase tracking-wider">Background Tracking</p>
              <p className="text-sm font-medium">{isTracking ? 'පසුබිමේ ක්‍රියාත්මක වේ...' : 'Live ගණනය ආරම්භ කරන්න'}</p>
            </div>
          </div>
          <button
            onClick={toggleTracking}
            className={`flex items-center gap-2 px-4 py-2 rounded-2xl font-bold text-sm transition-all ${
              isTracking 
                ? 'bg-red-500 text-white shadow-lg shadow-red-200 hover:bg-red-600' 
                : 'bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20 hover:bg-[#4A4A30]'
            }`}
          >
            {isTracking ? <><StopCircle size={16} /> නවත්වන්න</> : <><PlayCircle size={16} /> ආරම්භ කරන්න</>}
          </button>
        </motion.div>

        {/* Inputs */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-[32px] p-8 shadow-xl shadow-black/5 border border-black/5 mb-8"
        >
          <div className="space-y-6">
            <div>
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#5A5A40] mb-3">
                <Route size={14} />
                {isTracking ? 'දැනට දාවනය වූ දුර (කි.මී.)' : 'දිනකට ධාවනය වන දුර (කි.මී.)'}
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={isTracking ? liveDistance.toFixed(2) : distance}
                  onChange={(e) => !isTracking && setDistance(e.target.value)}
                  readOnly={isTracking}
                  className={`w-full bg-[#f5f5f0] border-none rounded-2xl px-5 py-4 text-lg font-semibold focus:ring-2 focus:ring-[#5A5A40] transition-all outline-none ${
                    isTracking ? 'text-red-600' : ''
                  }`}
                  placeholder="0"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#5A5A40]/50">km</span>
              </div>
            </div>

            <div className={isTracking ? 'opacity-50 pointer-events-none' : ''}>
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#5A5A40] mb-3">
                <Fuel size={14} />
                ඉන්ධන කාර්යක්ෂමතාව (කි.මී./ලී.)
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={efficiency}
                  onChange={(e) => setEfficiency(e.target.value)}
                  className="w-full bg-[#f5f5f0] border-none rounded-2xl px-5 py-4 text-lg font-semibold focus:ring-2 focus:ring-[#5A5A40] transition-all outline-none"
                  placeholder="0"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#5A5A40]/50">km/L</span>
              </div>
            </div>

            <div className={isTracking ? 'opacity-50 pointer-events-none' : ''}>
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#5A5A40] mb-3">
                <CircleDollarSign size={14} />
                ලීටරයක මිල (රු.)
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full bg-[#f5f5f0] border-none rounded-2xl px-5 py-4 text-lg font-semibold focus:ring-2 focus:ring-[#5A5A40] transition-all outline-none"
                  placeholder="0"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#5A5A40]/50">Rs.</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold text-[#5A5A40] hover:bg-[#5A5A40]/5 rounded-2xl transition-colors"
              >
                <RefreshCcw size={14} />
                Reset
              </button>
              <button
                onClick={saveToHistory}
                className="flex-[2] flex items-center justify-center gap-2 py-3 bg-[#5A5A40] text-white rounded-2xl font-bold shadow-lg shadow-[#5A5A40]/20 hover:bg-[#4A4A30] transition-all"
              >
                <Save size={16} />
                දත්ත සුරකින්න (Save)
              </button>
            </div>
          </div>
        </motion.div>

        {/* Results */}
        <div className="grid gap-4 mb-12">
          <AnimatePresence mode="wait">
            <motion.div
              key="daily"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-3xl p-6 flex items-center justify-between shadow-md border border-black/5"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                  <Fuel size={20} />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{isTracking ? 'දැනට වැයවූ ඉන්ධන' : 'දිනකට යන ඉන්ධන'}</p>
                  <p className="text-lg font-bold">{isTracking ? 'Fuel Used' : 'Daily Fuel'}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-blue-600">{results.dailyFuel.toFixed(2)}</p>
                <p className="text-xs font-bold text-gray-400 uppercase">Liters</p>
              </div>
            </motion.div>

            <motion.div
              key="cost"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-3xl p-6 flex items-center justify-between shadow-md border border-black/5"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-50 text-green-600 rounded-2xl">
                  <CircleDollarSign size={20} />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{isTracking ? 'දැනට වැයවූ පිරිවැය' : 'දිනකට යන පිරිවැය'}</p>
                  <p className="text-lg font-bold">{isTracking ? 'Current Cost' : 'Daily Cost'}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-green-600">Rs. {Math.round(results.dailyCost).toLocaleString()}</p>
                <p className="text-xs font-bold text-gray-400 uppercase">LKR</p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* History Section */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#5A5A40]/10 text-[#5A5A40] rounded-xl">
                <HistoryIcon size={18} />
              </div>
              <h2 className="text-xl font-bold">ඉතිහාසය (History)</h2>
            </div>
            {history.length > 0 && (
              <button onClick={clearHistory} className="text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1">
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>

          <div className="space-y-4">
            {history.length === 0 ? (
              <div className="text-center py-10 bg-white/50 rounded-[32px] border border-dashed border-[#5A5A40]/20">
                <p className="text-sm text-[#5A5A40]/50 font-medium">තවමත් දත්ත සුරැකී නොමැත.</p>
              </div>
            ) : (
              history.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white rounded-3xl p-5 shadow-sm border border-black/5 flex items-center justify-between group"
                >
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-bold text-[#5A5A40]/60 uppercase tracking-widest">{item.date}</p>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-sm font-bold">
                        <Route size={12} className="text-gray-400" />
                        {item.distance.toFixed(1)} km
                      </div>
                      <div className="flex items-center gap-1 text-sm font-bold">
                        <Fuel size={12} className="text-gray-400" />
                        {item.fuel.toFixed(2)} L
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg font-black text-[#5A5A40]">Rs. {Math.round(item.cost).toLocaleString()}</p>
                    </div>
                    <button 
                      onClick={() => deleteHistoryItem(item.id)}
                      className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Footer Info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-12 flex items-start gap-3 p-4 bg-white/50 rounded-2xl border border-black/5"
        >
          <Info size={16} className="text-[#5A5A40] mt-0.5 shrink-0" />
          <p className="text-xs text-[#5A5A40]/70 leading-relaxed">
            {isTracking 
              ? "සජීවීව ගණනය කිරීමේදී ඔබගේ දුරකථනයේ GPS භාවිතා වේ. හොඳ සංඥා පවතින ස්ථානයක මෙය වඩාත් නිවැරදි වේ."
              : "දත්ත සුරැකීමට (Save) බොත්තම භාවිතා කරන්න. එවිට ඔබගේ දෛනික වියදම් ඉතිහාසයට එකතු වේ."
            }
          </p>
        </motion.div>
      </div>
    </div>
  );
}
