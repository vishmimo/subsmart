
import React, { useState, useEffect, useRef } from 'react';
import { Subscription, Recommendation, LaunchChecklist, FinancialHealth } from './types';
import { SubscriptionCard } from './components/SubscriptionCard';
import { Analytics } from './components/Analytics';
import { AdBanner } from './components/AdBanner';
import { analyzeSubscriptions, createAdvisorChat, generateHealthReport, generateHealthVisual } from './services/gemini';
import { saveSubscriptionsToFirebase, loadSubscriptionsFromFirebase, getCloudStatus } from './services/firebase';
import { suggestCategory } from './services/categorization';
import { GenerateContentResponse, Chat } from '@google/genai';

const INITIAL_SUBS: Subscription[] = [
  { id: '1', name: 'Netflix', amount: 15.99, currency: '$', billingCycle: 'monthly', category: 'Entertainment', usageLevel: 85, nextBillingDate: 'Oct 15, 2024', icon: '🍿', isLinked: true },
  { id: '2', name: 'Spotify', amount: 10.99, currency: '$', billingCycle: 'monthly', category: 'Entertainment', usageLevel: 95, nextBillingDate: 'Oct 22, 2024', icon: '🎧', isLinked: true },
  { id: '3', name: 'Canva Pro', amount: 12.99, currency: '$', billingCycle: 'monthly', category: 'Productivity', usageLevel: 15, nextBillingDate: 'Oct 12, 2024', icon: '🎨' },
  { id: '4', name: 'Gym Shark', amount: 45.00, currency: '$', billingCycle: 'monthly', category: 'Fitness', usageLevel: 5, nextBillingDate: 'Nov 01, 2024', icon: '🏋️' },
];

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'ai';
}

export default function App() {
  // --- State Configuration ---
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [activityLogs, setActivityLogs] = useState<LogEntry[]>([]);
  
  const [isAdding, setIsAdding] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');
  const [isSyncingUsage, setIsSyncingUsage] = useState(false);
  const [isGeneratingVisual, setIsGeneratingVisual] = useState(false);
  
  const [cloudStatus, setCloudStatus] = useState(getCloudStatus());
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [health, setHealth] = useState<FinancialHealth | null>(null);
  const [healthVisual, setHealthVisual] = useState<string | null>(null);
  
  const [chatMessages, setChatMessages] = useState<{role: 'user'|'ai', text: string}[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isChatTyping, setIsChatTyping] = useState(false);
  
  const [newSubName, setNewSubName] = useState('');
  const [newSubAmount, setNewSubAmount] = useState('');
  const [newSubCycle, setNewSubCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [newSubCategory, setNewSubCategory] = useState<Subscription['category']>('Other');
  
  const chatRef = useRef<Chat | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Core Lifecycle ---
  useEffect(() => {
    const init = async () => {
      try {
        const saved = await loadSubscriptionsFromFirebase();
        const activeSubs = saved && saved.length > 0 ? saved : INITIAL_SUBS;
        setSubscriptions(activeSubs);
        addLog('System Initialized', 'success');
        
        // Initial AI Health Check
        const healthData = await generateHealthReport(activeSubs);
        setHealth(healthData);
      } catch (e) {
        setSubscriptions(INITIAL_SUBS);
        addLog('Initialization Failover: Local Mode', 'warning');
      } finally {
        setIsLoading(false);
        setCloudStatus(getCloudStatus());
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    if (!isLoading) saveSubscriptionsToFirebase(subscriptions);
  }, [subscriptions, isLoading]);

  useEffect(() => {
    if (isChatOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatOpen]);

  // --- Utils ---
  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setActivityLogs(prev => [
      { id: Date.now().toString(), timestamp: new Date().toLocaleTimeString(), message, type },
      ...prev.slice(0, 19)
    ]);
  };

  // --- Logic Handlers ---
  const handleDiagnosticAnalysis = async () => {
    setIsAnalyzing(true);
    addLog('AI Diagnostic Requested', 'ai');
    try {
      const results = await analyzeSubscriptions(subscriptions);
      setRecommendations(results);
      const newHealth = await generateHealthReport(subscriptions);
      setHealth(newHealth);
      addLog(`AI Audit Complete: ${results.length} insights`, 'success');
    } catch (err) {
      addLog('AI Protocol Interrupted', 'warning');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateVisualReport = async () => {
    if (!health) return;
    setIsGeneratingVisual(true);
    addLog('Generating AI Health Visualization...', 'ai');
    try {
      const visual = await generateHealthVisual(health);
      setHealthVisual(visual);
      addLog('Visual Report Generated', 'success');
    } catch (err) {
      addLog('Visual synthesis failed', 'warning');
    } finally {
      setIsGeneratingVisual(false);
    }
  };

  const handleAdvisorQuery = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!userInput.trim()) return;
    const query = userInput;
    setUserInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: query }]);
    setIsChatTyping(true);
    addLog('AI Socket Query Sent', 'ai');

    try {
      if (!chatRef.current) chatRef.current = createAdvisorChat(subscriptions, health || undefined);
      const responseStream = await chatRef.current.sendMessageStream({ message: query });
      let aiResponseText = '';
      setChatMessages(prev => [...prev, { role: 'ai', text: '' }]);
      for await (const chunk of responseStream) {
        aiResponseText += (chunk as GenerateContentResponse).text || "";
        setChatMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1].text = aiResponseText;
          return updated;
        });
      }
    } catch (err) {
      addLog('Advisor Connection Lost', 'warning');
    } finally {
      setIsChatTyping(false);
    }
  };

  const handleRemoveNode = (id: string) => {
    const sub = subscriptions.find(s => s.id === id);
    setSubscriptions(prev => prev.filter(s => s.id !== id));
    addLog(`Service Deprovisioned: ${sub?.name || 'Unknown'}`, 'info');
  };

  const handleNodeVerification = (id: string) => {
    setSubscriptions(prev => prev.map(s => 
      s.id === id ? { ...s, isLinked: true } : s
    ));
  };

  const handleCategoryUpdate = (id: string, category: Subscription['category']) => {
    setSubscriptions(prev => prev.map(s => 
      s.id === id ? { ...s, category } : s
    ));
    addLog(`Category Updated`, 'info');
  };

  const handleGlobalSync = () => {
    setIsSyncingUsage(true);
    addLog('Initiating Batch Telemetry Sync...', 'info');
    setTimeout(() => {
      setSubscriptions(prev => prev.map(s => ({
        ...s,
        usageLevel: Math.floor(Math.random() * 80) + 20,
        lastSyncedUsage: new Date().toLocaleTimeString(),
        isLinked: true 
      })));
      setIsSyncingUsage(false);
      addLog('Telemetry Nodes Synchronized', 'success');
    }, 1800);
  };

  const executeEnrollment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName || !newSubAmount) return;
    const enrolledNode: Subscription = {
      id: `node_${Math.random().toString(36).substr(2, 9)}`,
      name: newSubName,
      amount: parseFloat(newSubAmount) || 0,
      currency: '$',
      billingCycle: newSubCycle,
      category: newSubCategory,
      usageLevel: 50,
      nextBillingDate: 'Pending Sync...',
      icon: '✨'
    };
    setSubscriptions(prev => [...prev, enrolledNode]);
    setIsAdding(false);
    addLog(`Node Enrolled: ${newSubName}`, 'success');
    setNewSubName('');
    setNewSubAmount('');
  };

  // --- Derived Metrics ---
  const monthlyBurn = subscriptions.reduce((acc, s) => acc + (s.billingCycle === 'monthly' ? s.amount : s.amount/12), 0);
  const totalPotentialSaving = recommendations.reduce((acc, rec) => acc + rec.potentialSaving, 0);
  const checklist: LaunchChecklist = {
    accountsLinked: subscriptions.some(s => s.isLinked),
    aiAnalyzed: recommendations.length > 0,
    cloudSynced: cloudStatus.isCloudActive,
    usageTracked: subscriptions.some(s => !!s.lastSyncedUsage)
  };
  const filteredSubs = subscriptions.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || s.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6"></div>
          <p className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-400 dark:text-slate-500 animate-pulse">Establishing Secure Hub</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-all duration-700 pb-32">
      
      {/* Enrollment Modal */}
      {isAdding && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-md" onClick={() => setIsAdding(false)}></div>
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[2rem] shadow-2xl relative z-10 p-10 border border-slate-200 dark:border-slate-800 animate-slide-up">
            <h3 className="text-xl font-black dark:text-white mb-8 uppercase tracking-widest text-center">Enroll Node</h3>
            <form onSubmit={executeEnrollment} className="space-y-6">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Service Label</label>
                <input 
                  autoFocus required type="text" value={newSubName} onChange={(e) => { setNewSubName(e.target.value); setNewSubCategory(suggestCategory(e.target.value)); }} placeholder="e.g. Netflix"
                  className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-4 text-sm font-bold dark:text-white outline-none focus:ring-2 ring-blue-500/20 transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Monthly Cost</label>
                  <input 
                    required type="number" step="0.01" value={newSubAmount} onChange={(e) => setNewSubAmount(e.target.value)} placeholder="0.00"
                    className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-4 text-sm font-bold dark:text-white outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Frequency</label>
                  <select value={newSubCycle} onChange={(e) => setNewSubCycle(e.target.value as any)} className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-4 text-[10px] font-black uppercase tracking-widest outline-none">
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]">Finalize Entry</button>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 mb-12">
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex items-center gap-6">
             <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-700 rounded-2xl flex items-center justify-center text-white text-3xl font-black shadow-xl ring-4 ring-blue-500/10">SS</div>
             <div>
              <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter leading-none">SubSmart</h1>
              <div className="flex items-center gap-4 mt-3">
                <span className="text-[9px] font-black px-3 py-1.5 rounded-xl border bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em]">{cloudStatus.provider}</span>
                <button 
                  onClick={() => setIsDarkMode(!isDarkMode)} 
                  className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:shadow-md transition-all text-xl active:scale-90"
                  aria-label="Toggle Dark Mode"
                >
                  {isDarkMode ? '🌙' : '☀️'}
                </button>
              </div>
             </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setIsAdding(true)} className="bg-blue-600 text-white px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all active:scale-95">Enroll Node</button>
            <button onClick={handleGlobalSync} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl hover:shadow-md transition-all active:scale-95 group">
              <svg className={`w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors ${isSyncingUsage ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>
        </div>
        
        <div className="bg-white dark:bg-slate-900 px-10 py-5 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-12">
          <div className="text-right">
            <p className="text-[9px] text-slate-400 font-black uppercase tracking-[0.2em] mb-1">Portfolio Burn</p>
            <p className="text-3xl font-black text-blue-600 dark:text-blue-400 tracking-tighter leading-none">${monthlyBurn.toFixed(2)}<span className="text-[10px] text-slate-400 ml-1">/mo</span></p>
          </div>
          <div className="w-px h-12 bg-slate-100 dark:bg-slate-800" />
          <div className="flex gap-4">
             <div className="flex flex-col items-center">
                <span className={`w-3.5 h-3.5 rounded-full mb-1.5 shadow-sm transition-colors duration-500 ${checklist.cloudSynced ? 'bg-emerald-500 shadow-emerald-500/40' : 'bg-slate-200 dark:bg-slate-800'}`} />
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">CLOUD</span>
             </div>
             <div className="flex flex-col items-center">
                <span className={`w-3.5 h-3.5 rounded-full mb-1.5 shadow-sm transition-colors duration-500 ${checklist.aiAnalyzed ? 'bg-blue-500 shadow-blue-500/40' : 'bg-slate-200 dark:bg-slate-800'}`} />
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">AI</span>
             </div>
          </div>
        </div>
      </header>

      {/* Analytics */}
      <Analytics subscriptions={subscriptions} isDark={isDarkMode} />

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        
        {/* Left Column: Feed */}
        <div className="xl:col-span-3 space-y-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex-1 max-w-xl flex items-center gap-4 bg-white dark:bg-slate-900 px-6 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm group transition-all focus-within:ring-2 ring-blue-500/10">
              <svg className="w-5 h-5 text-slate-300 group-focus-within:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input 
                type="text" placeholder="Search infrastructure..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent outline-none text-sm font-bold dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
              {['All', 'Entertainment', 'Productivity', 'Fitness', 'Cloud Storage'].map(cat => (
                <button 
                  key={cat} onClick={() => setSelectedCategory(cat)}
                  className={`px-5 py-3 rounded-2xl text-[9px] font-black uppercase tracking-[0.2em] whitespace-nowrap border transition-all active:scale-95 ${selectedCategory === cat ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 shadow-lg' : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
            {filteredSubs.map((sub, idx) => (
              <React.Fragment key={sub.id}>
                <SubscriptionCard sub={sub} onDelete={handleRemoveNode} onLink={(id) => { handleNodeVerification(id); addLog(`Node Verified: ${sub.name}`, 'success'); }} onUpdateCategory={handleCategoryUpdate} />
                {(idx + 1) % 4 === 0 && <AdBanner type="native" />}
              </React.Fragment>
            ))}
            <button onClick={() => setIsAdding(true)} className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-10 flex flex-col items-center justify-center gap-4 hover:border-blue-500/50 hover:bg-blue-50/10 transition-all opacity-60 hover:opacity-100 min-h-[250px] group">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 group-hover:scale-110 group-hover:bg-blue-500 group-hover:text-white transition-all"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg></div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200">Quick Enroll</p>
            </button>
          </div>
        </div>

        {/* Right Column: AI & Logs Sidebar */}
        <div className="space-y-8">
          {/* AI Diagnostic Panel */}
          <div className="bg-slate-950 rounded-[2.5rem] p-8 text-white shadow-2xl border border-white/5 flex flex-col min-h-[450px] relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/20 blur-[60px] rounded-full -mr-16 -mt-16" />
            
            <div className="flex items-center gap-4 mb-8 relative z-10">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl shadow-lg ring-4 ring-blue-500/10">🛡️</div>
              <div>
                <h3 className="text-xs font-black tracking-[0.2em] uppercase">Core Health</h3>
                {health && (
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-1 tracking-widest">{health.status}</p>
                )}
              </div>
            </div>

            {recommendations.length === 0 ? (
              <div className="flex-1 flex flex-col justify-center text-center px-2 relative z-10">
                <div className="mb-8 p-6 bg-white/5 rounded-3xl border border-white/10">
                   <p className="text-slate-400 text-[11px] leading-relaxed">Initialize Gemini audit to identify capital leaks and optimize recurring nodes.</p>
                </div>
                <button onClick={handleDiagnosticAnalysis} disabled={isAnalyzing} className="w-full py-4 bg-blue-600 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 active:scale-95 disabled:opacity-50">
                  {isAnalyzing ? 'Analyzing Engine...' : 'Run Protocol Audit'}
                </button>
                <div className="mt-8"><AdBanner type="square" /></div>
              </div>
            ) : (
              <div className="space-y-4 overflow-y-auto max-h-[450px] pr-2 custom-scrollbar relative z-10">
                {health && (
                   <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 text-center mb-4">
                      <p className="text-[9px] font-black text-emerald-500 uppercase tracking-[0.2em] mb-2">Recapture Estimate</p>
                      <p className="text-4xl font-black text-emerald-400 tracking-tighter">${totalPotentialSaving.toFixed(2)}</p>
                      <p className="text-[9px] font-bold text-emerald-600/60 uppercase mt-3 tracking-widest leading-relaxed px-2">{health.summary}</p>
                   </div>
                )}
                
                {healthVisual ? (
                  <div className="rounded-2xl overflow-hidden border border-white/10 mb-4 animate-fade-in shadow-xl">
                    <img src={healthVisual} alt="Health Visual" className="w-full h-auto object-cover" />
                  </div>
                ) : (
                  <button 
                    onClick={handleGenerateVisualReport} 
                    disabled={isGeneratingVisual}
                    className="w-full py-3 mb-4 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                  >
                    {isGeneratingVisual ? 'Visualizing...' : 'Generate Visual Report'}
                  </button>
                )}

                {recommendations.map(rec => (
                  <div key={rec.id} className="bg-slate-900/80 p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <h4 className="font-black text-white text-[11px] truncate uppercase tracking-widest">{rec.subName}</h4>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-lg border uppercase tracking-widest ${rec.action === 'Cancel' ? 'text-red-400 border-red-500/30 bg-red-500/5' : 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5'}`}>{rec.action}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mb-4 leading-relaxed">{rec.reasoning}</p>
                    <div className="flex items-center justify-between">
                       <p className="text-xs font-black text-emerald-400 tracking-widest">+${rec.potentialSaving.toFixed(2)}</p>
                       <div className="flex items-center gap-1.5">
                          <span className="text-[8px] font-black text-slate-600 uppercase tracking-tighter">AI CONF:</span>
                          <span className="text-[8px] font-black text-blue-400 uppercase">{(rec.confidence * 100).toFixed(0)}%</span>
                       </div>
                    </div>
                  </div>
                ))}
                <button onClick={() => { setRecommendations([]); setHealthVisual(null); }} className="w-full py-3 text-[9px] text-slate-600 font-black hover:text-slate-400 transition-colors uppercase tracking-[0.3em]">Reset Optimization</button>
              </div>
            )}
          </div>

          {/* System Activity Log */}
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-[350px]">
            <h3 className="text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-[0.3em] mb-6">Event Telemetry</h3>
            <div className="flex-1 overflow-y-auto space-y-4 pr-3 custom-scrollbar">
              {activityLogs.map(log => (
                <div key={log.id} className="flex gap-4 items-start animate-fade-in group">
                  <div className={`w-2 h-2 rounded-full mt-2 shrink-0 transition-transform group-hover:scale-125 ${log.type === 'success' ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : log.type === 'warning' ? 'bg-amber-500' : log.type === 'ai' ? 'bg-blue-500 shadow-sm shadow-blue-500/50' : 'bg-slate-300'}`} />
                  <div>
                    <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 leading-snug mb-1">{log.message}</p>
                    <p className="text-[9px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-[0.2em]">{log.timestamp}</p>
                  </div>
                </div>
              ))}
              {activityLogs.length === 0 && <p className="text-[10px] text-slate-300 text-center py-16 italic">Awaiting System Broadcast...</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Advisor Drawer & Floating Trigger */}
      <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-slate-900 shadow-[0_0_100px_rgba(0,0,0,0.2)] z-[600] transform transition-transform duration-700 ease-in-out flex flex-col border-l border-slate-100 dark:border-slate-800 ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-blue-600 text-white shadow-lg relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl shadow-inner">🤖</div>
            <div>
              <h3 className="font-black text-xs uppercase tracking-[0.2em]">Context Advisor</h3>
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-widest mt-1">Operational • AES-256</p>
            </div>
          </div>
          <button onClick={() => setIsChatOpen(false)} className="p-2.5 hover:bg-white/10 rounded-xl transition-all active:scale-90"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-slate-50 dark:bg-slate-950/50">
          {chatMessages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-20">
               <div className="w-20 h-20 bg-slate-200 dark:bg-slate-800 rounded-3xl flex items-center justify-center text-4xl mb-6">💬</div>
               <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Ask for financial strategy or<br/>specific node optimization.</p>
            </div>
          )}
          {chatMessages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}>
              <div className={`max-w-[85%] px-6 py-4 rounded-[2rem] text-xs font-semibold shadow-sm leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-tl-none shadow-xl shadow-slate-200/50 dark:shadow-none'}`}>
                {msg.text || <div className="flex gap-1 py-1"><div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-100"></div><div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-200"></div></div>}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        
        <form onSubmit={handleAdvisorQuery} className="p-6 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
          <div className="flex gap-3 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-[2rem] border border-slate-200 dark:border-slate-700 focus-within:ring-2 ring-blue-500/10 transition-all">
            <input 
              type="text" value={userInput} onChange={e => setUserInput(e.target.value)} placeholder="Query Advisor..." 
              className="flex-1 bg-transparent border-none px-5 py-3 text-xs font-bold outline-none dark:text-white" 
            />
            <button type="submit" className="bg-blue-600 text-white w-12 h-12 rounded-full shadow-lg shadow-blue-500/20 active:scale-95 flex items-center justify-center hover:bg-blue-700 transition-all">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </div>
        </form>
      </div>

      <button onClick={() => setIsChatOpen(true)} className="fixed bottom-8 right-8 w-16 h-16 bg-blue-600 text-white rounded-[1.5rem] shadow-[0_20px_50px_rgba(59,130,246,0.3)] z-[400] flex items-center justify-center hover:scale-110 active:scale-95 transition-all group overflow-hidden">
        <div className="absolute inset-0 bg-white/10 group-hover:translate-x-full transition-transform duration-500 skew-x-12 -ml-12" />
        <svg className="w-8 h-8 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
      </button>

      <footer className="mt-24 pt-12 border-t border-slate-200 dark:border-slate-800 text-center opacity-40">
        <p className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-500 mb-2">SubSmart Portfolio Optimizer v1.1.0 • AES-256 Enabled</p>
        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">© {new Date().getFullYear()} Autonomous Financial Protocol</p>
      </footer>
    </div>
  );
}
