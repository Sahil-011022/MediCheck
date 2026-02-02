
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Chat } from "@google/genai";
import { UserProfile } from '../types';

interface AICompanionProps {
  user: UserProfile;
}

export const AICompanion: React.FC<AICompanionProps> = ({ user }) => {
  const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string }[]>([
    { role: 'model', text: `Hi ${user.displayName}, I'm your MediCheck Health Companion. How can I help you today? You can talk to me or type your message!` }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const chatRef = useRef<Chat | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    chatRef.current = ai.chats.create({
      model: 'gemini-3-flash-preview',
      config: {
        systemInstruction: `You are a friendly, empathetic AI health companion named MediCheck Buddy. 
        Talk to the user warmly. Always clarify you are an AI. User's name is ${user.displayName}.`,
      },
    });
  }, [user.displayName]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const speak = (text: string) => {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    synth.speak(utterance);
  };

  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("STT not supported.");
    
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
    };
    recognition.start();
  };

  const sendMessage = async () => {
    if (!input.trim() || !chatRef.current || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setLoading(true);

    try {
      const response = await chatRef.current.sendMessage({ message: userMessage });
      const responseText = response.text || "I'm sorry, I couldn't process that.";
      setMessages(prev => [...prev, { role: 'model', text: responseText }]);
      speak(responseText); 
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', text: "I'm having trouble connecting. Let's try again!" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-[40px] shadow-2xl border border-gray-100 dark:border-gray-800 h-[650px] flex flex-col overflow-hidden animate-fade-in transition-colors">
      <div className="bg-blue-600 dark:bg-blue-800 p-8 text-white flex items-center justify-between">
        <div className="flex items-center gap-4">
           <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center text-3xl">🤖</div>
           <div>
             <h3 className="font-black text-xl tracking-tight">MediCheck Buddy</h3>
             <p className="text-blue-100 text-xs font-bold uppercase tracking-widest opacity-80">Active AI Assistant</p>
           </div>
        </div>
        <div className="flex gap-2">
           <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.5)]"></div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 space-y-6 bg-gray-50/30 dark:bg-gray-950/30 custom-scrollbar">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-5 rounded-3xl text-sm font-medium shadow-sm leading-relaxed ${
              m.role === 'user' 
                ? 'bg-blue-600 text-white rounded-tr-none' 
                : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-none border border-gray-100 dark:border-gray-700'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-5 rounded-3xl rounded-tl-none shadow-sm flex gap-1">
              <span className="w-2 h-2 bg-blue-200 dark:bg-blue-900 rounded-full animate-bounce"></span>
              <span className="w-2 h-2 bg-blue-200 dark:bg-blue-900 rounded-full animate-bounce delay-75"></span>
              <span className="w-2 h-2 bg-blue-200 dark:bg-blue-900 rounded-full animate-bounce delay-150"></span>
            </div>
          </div>
        )}
      </div>

      <div className="p-6 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
        <div className="relative flex items-center gap-3">
          <button 
            onClick={startVoiceInput} 
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${isListening ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-100' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-blue-600'}`}
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"/></svg>
          </button>
          <div className="flex-1 relative">
            <input
              type="text"
              className="w-full pl-6 pr-14 py-4 rounded-2xl border border-gray-200 dark:border-gray-700 focus:ring-4 focus:ring-blue-50 dark:focus:ring-blue-900/20 outline-none transition text-sm bg-gray-50/50 dark:bg-gray-800/50 font-medium dark:text-white"
              placeholder="Ask Medicheck Buddy anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            />
            <button 
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-700 transition disabled:opacity-30 shadow-lg"
            >
              <svg className="w-5 h-5 rotate-90" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
