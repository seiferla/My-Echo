import { Plus, MessageSquare, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router';

interface Chat {
  id: string;
  title: string;
  messages: any[];
  timestamp: number;
}

interface SidebarProps {
  isOpen: boolean;
  chats: Chat[];
  currentChatId: string;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}

export function Sidebar({ isOpen, chats, currentChatId, onSelectChat, onNewChat, onClose }: SidebarProps) {
  const navigate = useNavigate();
  
  const handleSelectChat = (id: string) => {
    onSelectChat(id);
    // Auf Mobile schließe Sidebar nach Auswahl
    if (window.innerWidth < 768) {
      onClose();
    }
  };

  // Gruppiere Chats nach Datum
  const groupChatsByDate = () => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    const oneMonth = 30 * oneDay;

    const groups: { [key: string]: Chat[] } = {
      'Heute': [],
      'Gestern': [],
      'Letzte 7 Tage': [],
      'Letzte 30 Tage': [],
      'Älter': [],
    };

    chats.forEach(chat => {
      const diff = now - chat.timestamp;
      if (diff < oneDay) {
        groups['Heute'].push(chat);
      } else if (diff < 2 * oneDay) {
        groups['Gestern'].push(chat);
      } else if (diff < oneWeek) {
        groups['Letzte 7 Tage'].push(chat);
      } else if (diff < oneMonth) {
        groups['Letzte 30 Tage'].push(chat);
      } else {
        groups['Älter'].push(chat);
      }
    });

    return groups;
  };

  const groupedChats = groupChatsByDate();

  if (!isOpen) return null;

  return (
    <div className="w-64 md:w-72 bg-gray-50 dark:bg-[#171717] border-r border-gray-200 dark:border-gray-700 flex flex-col fixed md:relative h-full z-20 md:z-0">
      <div className="p-3 space-y-2">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-3 px-3 py-2.5 md:py-3 rounded-lg border border-gray-300 dark:border-gray-600 hover:border-sky-400 dark:hover:border-sky-500 hover:bg-sky-50 dark:hover:bg-gray-700 transition-all touch-manipulation"
        >
          <Plus className="w-4 h-4 md:w-5 md:h-5 text-gray-700 dark:text-gray-300" />
          <span className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">
            Neuer Chat
          </span>
        </button>
        
        <button
          onClick={() => navigate('/phrases')}
          className="w-full flex items-center gap-3 px-3 py-2.5 md:py-3 rounded-lg border border-sky-400 dark:border-sky-500 bg-sky-50 dark:bg-sky-900/30 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-all touch-manipulation"
        >
          <MessageCircle className="w-4 h-4 md:w-5 md:h-5 text-sky-600 dark:text-sky-400" />
          <span className="text-sm md:text-base font-medium text-sky-700 dark:text-sky-400">
            Phrasen
          </span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 space-y-1">
        {Object.entries(groupedChats).map(([group, groupChats]) => {
          if (groupChats.length === 0) return null;
          return (
            <div key={group} className="mb-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2">
                {group}
              </h3>
              {groupChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => handleSelectChat(chat.id)}
                  className={`w-full flex items-center gap-3 px-3 py-3 md:py-3.5 rounded-lg text-left group transition-colors touch-manipulation ${
                    chat.id === currentChatId
                      ? 'bg-sky-50 dark:bg-gray-700 border-l-2 border-sky-500'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <MessageSquare className={`w-4 h-4 md:w-5 md:h-5 flex-shrink-0 ${
                    chat.id === currentChatId 
                      ? 'text-sky-600 dark:text-sky-400' 
                      : 'text-gray-600 dark:text-gray-400'
                  }`} />
                  <span className="text-sm md:text-base text-gray-800 dark:text-gray-200 truncate flex-1">
                    {chat.title}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-sm font-semibold">
            U
          </div>
          <span className="text-sm md:text-base text-gray-700 dark:text-gray-300">Benutzer</span>
        </div>
      </div>
    </div>
  );
}