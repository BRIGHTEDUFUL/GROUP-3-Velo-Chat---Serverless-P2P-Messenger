
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
  const peerInitialized = useRef(false);

  const generateInviteLink = useCallback((id: string) => {
    const baseUrl = window.location.origin + window.location.pathname;
    const url = new URL(baseUrl);
    url.searchParams.set('id', id);
    return url.href;
  }, []);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
    if (activeChatId) {
      setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, unreadCount: 0 } : c));
    }
  }, [activeChatId]);

  useEffect(() => {
    if (user) localStorage.setItem('velo_chat_user', JSON.stringify(user));
  }, [user]);

  useEffect(() => {
    localStorage.setItem('velo_chat_chats', JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem('velo_chat_messages', JSON.stringify(messages));
  }, [messages]);

  const sendPacket = useCallback((peerId: string, packet: P2PDataPacket): boolean => {
    const conn = connRefs.current.get(peerId);
    if (conn && conn.open) {
      conn.send(packet);
      return true;
    }
    return false;
  }, []);

  const handleData = useCallback((data: P2PDataPacket, remotePeerId: string) => {
    switch (data.type) {
      case 'MESSAGE': {
        const msg = data.payload;
        sendPacket(remotePeerId, {
          type: 'DELIVERY_CONFIRM',
          payload: { chatId: msg.chatId, messageId: msg.id }
        });

        setMessages(prev => {
          if (prev.find(m => m.id === msg.id)) return prev;
          return [...prev, { ...msg, status: 'delivered' }];
        });

        setChats(prev => prev.map(chat => {
          if (chat.id === msg.chatId) {
            const currentUserId = user?.id || '';
            if (activeChatIdRef.current === chat.id) {
              sendPacket(remotePeerId, {
                type: 'READ_RECEIPT',
                payload: { chatId: chat.id, messageId: msg.id, userId: currentUserId }
              });
            }
            return {
              ...chat,
              lastMessage: { ...msg, status: 'delivered' },
              unreadCount: activeChatIdRef.current === chat.id ? 0 : chat.unreadCount + 1,
              isTyping: false
            };
          }
          return chat;
        }));
        break;
      }
      case 'DELIVERY_CONFIRM': {
        const { messageId, chatId } = data.payload;
        setMessages(prev => prev.map(m => (m.id === messageId) ? { ...m, status: 'delivered' } : m));
        setChats(prev => prev.map(c => 
          (c.id === chatId && c.lastMessage?.id === messageId) 
          ? { ...c, lastMessage: { ...c.lastMessage, status: 'delivered' } } 
          : c
        ));
        break;
      }
      case 'READ_RECEIPT': {
        const { messageId, chatId } = data.payload;
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: 'read' } : m));
        setChats(prev => prev.map(c => 
          (c.id === chatId && c.lastMessage?.id === messageId) 
          ? { ...c, lastMessage: { ...c.lastMessage, status: 'read' } } 
          : c
        ));
        break;
      }
      case 'TYPING': {
        const { chatId, userId, isTyping } = data.payload;
        setChats(prev => prev.map(c => {
          if (c.id === chatId) {
            return { ...c, isTyping, typingUser: isTyping ? userId : undefined };
          }
          return c;
        }));
        break;
      }
      case 'GROUP_INVITE': {
        const groupChat = data.payload;
        setChats(prev => {
          if (prev.find(c => c.id === groupChat.id)) return prev;
          return [...prev, groupChat];
        });
        break;
      }
    }
  }, [sendPacket, user?.id]);

  const setupConnection = useCallback((conn: DataConnection, peerId: string, autoSelect: boolean = false) => {
    conn.on('open', () => {
      connRefs.current.set(peerId, conn);
      const userStr = localStorage.getItem('velo_chat_user') || '{}';
      const currentUserId = JSON.parse(userStr).id;

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
          name: `Node ${peerId.slice(0, 4)}`,
          isGroup: false,
          participants: [currentUserId, peerId],
          unreadCount: 0,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${peerId}`
        }];
      });
    });

    conn.on('data', (data) => handleData(data as P2PDataPacket, peerId));
    conn.on('close', () => connRefs.current.delete(peerId));
    conn.on('error', () => connRefs.current.delete(peerId));
  }, [handleData]);

  const connectToPeer = useCallback((peerId: string, currentPeer: Peer, autoSelect: boolean = false) => {
    if (!peerId || !currentPeer) return;
    const currentUserStr = localStorage.getItem('velo_chat_user');
    if (!currentUserStr) return;
    const currentUser = JSON.parse(currentUserStr);

    if (peerId === currentUser.id || connRefs.current.has(peerId)) {
      if (autoSelect) {
        setChats(prev => {
          const chat = prev.find(c => !c.isGroup && c.participants.includes(peerId));
          if (chat) setActiveChatId(chat.id);
          return prev;
        });
      }
      return;
    }

    const conn = currentPeer.connect(peerId, { reliable: true });
    setupConnection(conn, peerId, autoSelect);
  }, [setupConnection]);

  const initPeer = useCallback((profile: UserProfile) => {
    if (peerInitialized.current) return;
    peerInitialized.current = true;
    setInitError(null);
    setIsInitializing(true);

    const newPeer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    newPeer.on('open', (id) => {
      const updatedUser = { ...profile, id };
      setUser(updatedUser);
      localStorage.setItem('velo_chat_user', JSON.stringify(updatedUser));
      
      const urlParams = new URLSearchParams(window.location.search);
      const inviteId = urlParams.get('id');
      if (inviteId && inviteId !== id) {
        setTimeout(() => connectToPeer(inviteId, newPeer, true), 1500);
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('id');
        window.history.replaceState({}, document.title, newUrl.pathname + newUrl.search);
      }
      setIsInitializing(false);
      setPeer(newPeer);
    });

    newPeer.on('connection', (conn) => setupConnection(conn, conn.peer));
    newPeer.on('error', (err) => {
      if (!newPeer.open) {
        setInitError(`Nexus Error: ${err.type}.`);
        setIsInitializing(false);
        peerInitialized.current = false;
      }
    });

    return newPeer;
  }, [connectToPeer, setupConnection]);

  useEffect(() => {
    const savedUser = localStorage.getItem('velo_chat_user');
    if (savedUser) {
      const p = JSON.parse(savedUser);
      const pInstance = initPeer(p);
      return () => {
        pInstance?.destroy();
        peerInitialized.current = false;
      };
    } else {
      setIsInitializing(false);
    }
  }, [initPeer]);

  const sendMessage = async (chatId: string, content: string, type: MessageType = MessageType.TEXT) => {
    if (!user || !peer) return;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    const messageId = uuidv4();
    const newMessage: Message = {
      id: messageId,
      senderId: user.id,
      senderName: user.name,
      content,
      timestamp: Date.now(),
      type,
      chatId,
      status: 'sending'
    };

    setMessages(prev => [...prev, newMessage]);
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, lastMessage: newMessage } : c));

    setTimeout(() => {
      const userStr = localStorage.getItem('velo_chat_user');
      if (!userStr) return;
      const currentUserId = JSON.parse(userStr).id;
      let success = false;
      chat.participants.forEach(pId => {
        if (pId !== currentUserId) {
          if (sendPacket(pId, { type: 'MESSAGE', payload: { ...newMessage, status: 'sent' } })) {
            success = true;
          }
        }
      });
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: success ? 'sent' : 'failed' } : m));
    }, 50);

    if (content.toLowerCase().startsWith('@gemini')) {
      const response = await gemini.current.getChatResponse(content.replace('@gemini', '').trim());
      if (response) {
        const aiMsg: Message = {
          id: uuidv4(),
          senderId: 'gemini-ai',
          senderName: 'Velo AI',
          content: response,
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

  const handleTyping = (chatId: string, isTyping: boolean) => {
    if (!user) return;
    const userStr = localStorage.getItem('velo_chat_user');
    if (!userStr) return;
    const currentUserId = JSON.parse(userStr).id;
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      chat.participants.forEach(pId => {
        if (pId !== currentUserId) {
          sendPacket(pId, { type: 'TYPING', payload: { chatId, userId: user.name, isTyping } });
        }
      });
    }
  };

  const createGroup = (name: string, participantIds: string[]) => {
    if (!user) return;
    const groupId = uuidv4();
    const newChat: Chat = {
      id: groupId,
      name,
      isGroup: true,
      participants: [user.id, ...participantIds],
      unreadCount: 0,
      avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${groupId}`
    };
    setChats(prev => [...prev, newChat]);
    participantIds.forEach(pId => sendPacket(pId, { type: 'GROUP_INVITE', payload: newChat }));
    setActiveChatId(groupId);
  };

  const activeChat = chats.find(c => c.id === activeChatId);
  const activeMessages = messages.filter(m => m.chatId === activeChatId);

  if (!user) {
    return (
      <WelcomeScreen 
        onProfileComplete={(profile) => initPeer(profile)}
        isInitializing={isInitializing}
        error={initError}
        onRetry={() => {
            const savedUser = localStorage.getItem('velo_chat_user');
            if (savedUser) initPeer(JSON.parse(savedUser));
            else window.location.reload();
        }}
      />
    );
  }

  return (
    <div className="flex h-screen bg-[#f0f2f5] overflow-hidden text-gray-900 selection:bg-teal-100 font-sans">
      <div className={`flex flex-col h-full w-full md:w-[440px] shrink-0 border-r border-gray-100 transition-all duration-300 ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
        <Sidebar 
          user={user} 
          chats={chats} 
          activeChatId={activeChatId} 
          onChatSelect={(id) => setActiveChatId(id)}
          onConnect={(id) => peer && connectToPeer(id, peer, true)}
          onCreateGroup={createGroup}
          inviteLink={generateInviteLink(user.id)}
        />
      </div>
      <div className={`flex-1 relative flex flex-col min-w-0 h-full bg-white transition-all duration-300 ${!activeChatId ? 'hidden md:flex' : 'flex'}`}>
        {activeChat ? (
          <ChatArea 
            chat={activeChat} 
            messages={activeMessages} 
            onSendMessage={sendMessage} 
            onTyping={handleTyping}
            currentUser={user}
            onBack={() => setActiveChatId(null)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center whatsapp-bg h-full">
            <div className="bg-white/95 p-12 md:p-16 rounded-[4rem] shadow-2xl text-center backdrop-blur-3xl max-w-2xl border border-white group hidden md:block">
              <div className="w-24 h-24 bg-teal-600 rounded-[2.5rem] mx-auto mb-8 flex items-center justify-center text-white">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h1 className="text-5xl font-black text-gray-900 mb-6">Velo <span className="text-teal-600">Mesh</span></h1>
              <p className="text-gray-500 mb-10 text-lg font-medium">Distributed P2P Messaging Hub</p>
              <div className="p-6 bg-gray-50/50 rounded-3xl border border-gray-100 w-full hover:bg-white transition-all shadow-inner">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Your Nexus Link</p>
                <code className="block text-teal-700 font-mono text-xs break-all bg-white p-4 rounded-xl border border-gray-200 mb-4 select-all">
                  {generateInviteLink(user.id)}
                </code>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(generateInviteLink(user.id));
                    alert('Copied!');
                  }}
                  className="px-8 py-3 bg-teal-600 text-white rounded-2xl font-black hover:bg-teal-700 transition-all active:scale-95"
                >
                  Copy Link
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
