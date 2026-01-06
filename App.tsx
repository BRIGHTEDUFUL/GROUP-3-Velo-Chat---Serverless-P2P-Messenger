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

const App: React.FC = () => {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('velo_chat_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) { 
      console.error("Storage Error:", e);
      return null; 
    }
  });
  
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      const saved = localStorage.getItem('velo_chat_chats');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem('velo_chat_messages');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const connRefs = useRef<Map<string, DataConnection>>(new Map());
  const activeChatIdRef = useRef<string | null>(null);

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
    const url = new URL(window.location.href);
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
        if (existing) { 
          if (autoSelect) setActiveChatId(existing.id); 
          return prev; 
        }
        const newChatId = uuidv4();
        if (autoSelect) setActiveChatId(newChatId);
        return [...prev, { 
          id: newChatId, 
          name: `Node ${peerId.slice(0, 6).toUpperCase()}`, 
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
    try {
      const newPeer = new Peer({ 
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } 
      });

      newPeer.on('open', (id) => {
        const u = { ...profile, id };
        setUser(u);
        localStorage.setItem('velo_chat_user', JSON.stringify(u));
        const inviteId = new URLSearchParams(window.location.search).get('id');
        if (inviteId && inviteId !== id) {
          setTimeout(() => setupConnection(newPeer.connect(inviteId, { reliable: true }), inviteId, true), 1000);
        }
        setIsInitializing(false);
        setPeer(newPeer);
      });

      newPeer.on('connection', (c) => setupConnection(c, c.peer));
      newPeer.on('error', () => {
        setInitError("Network restricted. P2P Handshake failed.");
        setIsInitializing(false);
      });
    } catch (e) {
      setInitError("System failure.");
      setIsInitializing(false);
    }
  }, [setupConnection]);

  useEffect(() => {
    if (user && !peer) initPeer(user);
    else if (!user) setIsInitializing(false);
  }, [user, peer, initPeer]);

  const sendMessage = (chatId: string, content: string) => {
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
    chat?.participants.forEach(pId => {
      if (pId !== user.id) sendPacket(pId, { type: 'MESSAGE', payload: msg });
    });
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
      avatar: `https://api.dicebear.com/7.x/shapes/svg?seed=${groupId}`
    };
    setChats(prev => [...prev, newChat]);
    participants.forEach(pId => sendPacket(pId, { type: 'GROUP_INVITE', payload: newChat }));
    setActiveChatId(groupId);
  };

  if (!user) return <WelcomeScreen onProfileComplete={initPeer} isInitializing={isInitializing} error={initError} onRetry={() => window.location.reload()} />;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden text-slate-900">
      <div className={`flex flex-col h-full w-full md:w-[400px] shrink-0 border-r border-slate-200 ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
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
      <div className={`flex-1 flex flex-col h-full bg-white ${!activeChatId ? 'hidden md:flex' : 'flex'}`}>
        {activeChatId ? (
          <ChatArea 
            chat={chats.find(c => c.id === activeChatId)!} 
            messages={messages.filter(m => m.chatId === activeChatId)} 
            onSendMessage={sendMessage} 
            onTyping={(chatId, isTyping) => {
              const chat = chats.find(c => c.id === chatId);
              chat?.participants.forEach(pId => {
                if (pId !== user.id) sendPacket(pId, { type: 'TYPING', payload: { chatId, userId: user.name, isTyping } });
              });
            }} 
            currentUser={user} 
            onBack={() => setActiveChatId(null)} 
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center mesh-bg h-full relative p-6">
            <div className="absolute inset-0 mesh-dot-grid" />
            <div className="bg-white/95 p-10 rounded-[3rem] shadow-2xl text-center backdrop-blur-md max-w-sm border border-white z-10">
              <h1 className="text-4xl font-black text-slate-900 mb-2">Velo Mesh</h1>
              <p className="text-slate-500 mb-8 font-medium">Distributed P2P Sovereignty.</p>
              <button 
                onClick={() => { navigator.clipboard.writeText(generateInviteLink(user.id)); alert('Linked!'); }}
                className="w-full py-4 bg-teal-600 text-white rounded-2xl font-bold shadow-lg hover:bg-teal-700"
              >
                Copy My Node Link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;