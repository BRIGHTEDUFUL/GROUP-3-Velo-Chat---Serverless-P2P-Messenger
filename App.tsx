
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Peer, DataConnection } from 'peerjs';
import { v4 as uuidv4 } from 'uuid';
import { 
  Message, 
  Chat, 
  UserProfile, 
  MessageType, 
  P2PDataPacket 
} from './types.ts';
import Sidebar from './Sidebar.tsx';
import ChatArea from './ChatArea.tsx';
import WelcomeScreen from './WelcomeScreen.tsx';
import { GeminiService } from './geminiService.ts';

const App: React.FC = () => {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('velo_chat_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [chats, setChats] = useState<Chat[]>(() => {
    const saved = localStorage.getItem('velo_chat_chats');
    return saved ? JSON.parse(saved) : [];
  });
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('velo_chat_messages');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const connRefs = useRef<Map<string, DataConnection>>(new Map());
  const activeChatIdRef = useRef<string | null>(null);
  const gemini = useRef(new GeminiService());

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
    if (activeChatId) {
      setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, unreadCount: 0 } : c));
    }
  }, [activeChatId]);

  useEffect(() => {
    localStorage.setItem('velo_chat_chats', JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem('velo_chat_messages', JSON.stringify(messages));
  }, [messages]);

  const generateInviteLink = useCallback((id: string) => {
    const baseUrl = window.location.origin + window.location.pathname;
    const url = new URL(baseUrl);
    url.searchParams.set('id', id);
    return url.href;
  }, []);

  const sendPacket = useCallback((peerId: string, packet: P2PDataPacket) => {
    const conn = connRefs.current.get(peerId);
    if (conn && conn.open) {
      conn.send(packet);
      return true;
    }
    return false;
  }, []);

  const handleData = useCallback((data: P2PDataPacket, remotePeerId: string) => {
    switch (data.type) {
      case 'MESSAGE':
        const msg = data.payload;
        sendPacket(remotePeerId, { type: 'DELIVERY_CONFIRM', payload: { chatId: msg.chatId, messageId: msg.id } });
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, status: 'delivered' }]);
        setChats(prev => prev.map(c => c.id === msg.chatId ? { 
          ...c, 
          lastMessage: msg, 
          unreadCount: activeChatIdRef.current === c.id ? 0 : c.unreadCount + 1,
          isTyping: false
        } : c));
        break;
      case 'DELIVERY_CONFIRM':
        setMessages(prev => prev.map(m => m.id === data.payload.messageId ? { ...m, status: 'delivered' } : m));
        break;
      case 'TYPING':
        setChats(prev => prev.map(c => c.id === data.payload.chatId ? { ...c, isTyping: data.payload.isTyping, typingUser: data.payload.userId } : c));
        break;
      case 'GROUP_INVITE':
        setChats(prev => prev.some(c => c.id === data.payload.id) ? prev : [...prev, data.payload]);
        break;
    }
  }, [sendPacket]);

  const setupConnection = useCallback((conn: DataConnection, peerId: string, autoSelect = false) => {
    conn.on('open', () => {
      connRefs.current.set(peerId, conn);
      setChats(prev => {
        const existing = prev.find(c => !c.isGroup && c.participants.includes(peerId));
        if (existing) { if (autoSelect) setActiveChatId(existing.id); return prev; }
        const newChatId = uuidv4();
        if (autoSelect) setActiveChatId(newChatId);
        return [...prev, { 
          id: newChatId, 
          name: `Node ${peerId.slice(0, 6)}`, 
          isGroup: false, 
          participants: [user!.id, peerId], 
          unreadCount: 0, 
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${peerId}` 
        }];
      });
    });
    conn.on('data', (d) => handleData(d as P2PDataPacket, peerId));
    conn.on('close', () => connRefs.current.delete(peerId));
  }, [handleData, user]);

  const initPeer = useCallback((profile: UserProfile) => {
    setIsInitializing(true);
    setInitError(null);
    const newPeer = new Peer({ 
      config: { 
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }, 
          { urls: 'stun:global.stun.twilio.com:3478' }
        ] 
      } 
    });

    newPeer.on('open', (id) => {
      const u = { ...profile, id };
      setUser(u);
      localStorage.setItem('velo_chat_user', JSON.stringify(u));
      const inviteId = new URLSearchParams(window.location.search).get('id');
      if (inviteId && inviteId !== id) {
        setTimeout(() => {
          const conn = newPeer.connect(inviteId, { reliable: true });
          setupConnection(conn, inviteId, true);
        }, 1200);
      }
      setIsInitializing(false);
      setPeer(newPeer);
    });

    newPeer.on('connection', (c) => setupConnection(c, c.peer));
    newPeer.on('error', (err) => {
      console.error('PeerJS Mesh Error:', err);
      setIsInitializing(false);
      setInitError("Network Handshake Failed. Connection is restricted.");
    });
  }, [setupConnection]);

  useEffect(() => {
    const saved = localStorage.getItem('velo_chat_user');
    if (saved && !peer) initPeer(JSON.parse(saved));
    else setIsInitializing(false);
  }, [initPeer, peer]);

  const sendMessage = async (chatId: string, content: string) => {
    if (!user) return;
    const msg: Message = { 
      id: uuidv4(), 
      senderId: user.id, 
      senderName: user.name, 
      content, 
      timestamp: Date.now(), 
      type: MessageType.TEXT, 
      chatId, 
      status: 'sending' 
    };
    
    setMessages(prev => [...prev, msg]);
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, lastMessage: msg } : c));
    
    const chat = chats.find(c => c.id === chatId);
    let sentToAnyone = false;
    chat?.participants.forEach(pId => {
      if (pId !== user.id) {
        if (sendPacket(pId, { type: 'MESSAGE', payload: msg })) sentToAnyone = true;
      }
    });

    if (sentToAnyone) {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'sent' } : m));
    }

    if (content.toLowerCase().includes('@gemini')) {
      const reply = await gemini.current.getChatResponse(content);
      if (reply) {
        const aiMsg: Message = { 
          id: uuidv4(), 
          senderId: 'gemini-ai', 
          senderName: 'Velo AI', 
          content: reply, 
          timestamp: Date.now(), 
          type: MessageType.TEXT, 
          chatId, 
          status: 'read' 
        };
        setMessages(prev => [...prev, aiMsg]);
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, lastMessage: aiMsg } : c));
      }
    }
  };

  const handleCreateGroup = (name: string, participants: string[]) => {
    if (!user) return;
    const groupId = uuidv4();
    const newChat: Chat = {
      id: groupId,
      name,
      isGroup: true,
      participants: [user.id, ...participants],
      unreadCount: 0,
      avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${groupId}`
    };
    setChats(prev => [...prev, newChat]);
    participants.forEach(pId => sendPacket(pId, { type: 'GROUP_INVITE', payload: newChat }));
    setActiveChatId(groupId);
  };

  const handleTyping = (chatId: string, isTyping: boolean) => {
    if (!user) return;
    const chat = chats.find(c => c.id === chatId);
    chat?.participants.forEach(pId => {
      if (pId !== user.id) {
        sendPacket(pId, { type: 'TYPING', payload: { chatId, userId: user.name, isTyping } });
      }
    });
  };

  if (!user) return <WelcomeScreen onProfileComplete={initPeer} isInitializing={isInitializing} error={initError} onRetry={() => window.location.reload()} />;

  return (
    <div className="flex h-screen bg-[#f0f2f5] overflow-hidden text-gray-900 selection:bg-teal-100 font-sans">
      <div className={`flex flex-col h-full w-full md:w-[440px] shrink-0 border-r border-gray-100 transition-all duration-300 ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
        <Sidebar 
          user={user} 
          chats={chats} 
          activeChatId={activeChatId} 
          onChatSelect={setActiveChatId} 
          onConnect={(id) => peer && setupConnection(peer.connect(id, { reliable: true }), id, true)} 
          onCreateGroup={handleCreateGroup}
          inviteLink={generateInviteLink(user.id)} 
        />
      </div>
      <div className={`flex-1 relative flex flex-col min-w-0 h-full bg-white transition-all duration-300 ${!activeChatId ? 'hidden md:flex' : 'flex'}`}>
        {activeChatId ? (
          <ChatArea 
            chat={chats.find(c => c.id === activeChatId)!} 
            messages={messages.filter(m => m.chatId === activeChatId)} 
            onSendMessage={sendMessage} 
            onTyping={handleTyping} 
            currentUser={user} 
            onBack={() => setActiveChatId(null)} 
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center whatsapp-bg h-full mesh-grid">
            <div className="bg-white/95 p-16 rounded-[4rem] shadow-2xl text-center backdrop-blur-3xl max-w-2xl border border-white group hidden md:block">
              <div className="w-24 h-24 bg-teal-600 rounded-[2.5rem] mx-auto mb-8 flex items-center justify-center text-white shadow-xl rotate-3 group-hover:rotate-0 transition-transform duration-700">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h1 className="text-5xl font-black text-gray-900 mb-6">Velo <span className="text-teal-600">Mesh</span></h1>
              <p className="text-gray-500 mb-12 text-lg font-medium">Distributed Sovereignty • Pure Peer-to-Peer</p>
              
              <div className="p-8 bg-gray-50 rounded-[2.5rem] border border-gray-100 w-full hover:bg-white transition-all duration-500 shadow-inner">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-4">Your Nexus Global Link</p>
                <code className="block text-teal-700 font-mono text-xs break-all bg-white p-6 rounded-2xl border border-gray-200 mb-6 select-all shadow-sm">
                  {generateInviteLink(user.id)}
                </code>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(generateInviteLink(user.id));
                    alert('Invite Link Copied!');
                  }}
                  className="px-10 py-4 bg-teal-600 text-white rounded-2xl font-black hover:bg-teal-700 transition-all shadow-xl active:scale-95"
                >
                  Copy Handshake Link
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
