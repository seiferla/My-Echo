import { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { Menu, PenSquare, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Chat, ChatMessage } from '../types';

export function ChatInterface() {
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentChatId, setCurrentChatId] = useState('1');
  const [chats, setChats] = useState<Chat[]>([
    { id: '1', title: 'Neuer Chat', messages: [], timestamp: Date.now() },
  ]);
  const isLoadedRef = useRef(false);

  // Lade Chats aus localStorage beim Start
  useEffect(() => {
    const savedChats = localStorage.getItem('myEchoChats');
    if (savedChats) {
      try {
        const parsed = JSON.parse(savedChats);
        setChats(parsed);
      } catch (e) {
        console.error('Fehler beim Laden der Chats:', e);
      }
    }
    isLoadedRef.current = true;
  }, []);

  // Speichere Chats in localStorage bei Änderungen (nicht beim ersten Render)
  useEffect(() => {
    if (!isLoadedRef.current) return;
    localStorage.setItem('myEchoChats', JSON.stringify(chats));
  }, [chats]);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const createNewChat = () => {
    const newChat = {
      id: Date.now().toString(),
      title: 'Neuer Chat',
      messages: [],
      timestamp: Date.now(),
    };
    setChats([newChat, ...chats]);
    setCurrentChatId(newChat.id);
  };

  const selectChat = (id: string) => {
    setCurrentChatId(id);
  };

  const updateChat = (id: string, messages: ChatMessage[]) => {
    setChats(chats.map(chat => 
      chat.id === id 
        ? { ...chat, messages, title: messages[0]?.content.slice(0, 30) || 'Neuer Chat' }
        : chat
    ));
  };

  const currentChat = chats.find(chat => chat.id === currentChatId);

  return (
    <div className="flex h-screen bg-white dark:bg-[#212121] overflow-hidden">
      {/* Overlay für Mobile */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-10 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      
      <Sidebar
        isOpen={isSidebarOpen}
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={selectChat}
        onNewChat={createNewChat}
        onClose={() => setIsSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-2 px-3 md:px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#212121]">
          <button
            onClick={toggleSidebar}
            className="p-2 hover:bg-sky-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Menu className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
          <div className="flex-1 text-center">
            <span className="text-sm md:text-base font-semibold text-gray-800 dark:text-gray-200">
              myEcho
            </span>
          </div>
          <button
            onClick={() => navigate('/phrases')}
            className="p-2 hover:bg-sky-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Phrasen"
          >
            <MessageCircle className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          </button>
          <button
            onClick={createNewChat}
            className="p-2 hover:bg-sky-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Neue Konversation"
          >
            <PenSquare className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          </button>
        </header>
        <ChatArea
          chat={currentChat}
          onUpdateChat={(messages) => updateChat(currentChatId, messages)}
        />
      </div>
    </div>
  );
}