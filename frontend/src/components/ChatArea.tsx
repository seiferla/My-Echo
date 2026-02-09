import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { Message } from './Message';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatAreaProps {
  chat?: {
    id: string;
    title: string;
    messages: ChatMessage[];
  };
  onUpdateChat: (messages: ChatMessage[]) => void;
}

export function ChatArea({ chat, onUpdateChat }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chat?.messages]);

  const handleSend = async () => {
    if (!input.trim() || !chat) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input,
    };

    const updatedMessages = [...chat.messages, userMessage];
    onUpdateChat(updatedMessages);
    setInput('');

    // Nachricht vorlesen
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(userMessage.content);
      utterance.lang = 'de-DE';
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {chat?.messages.length === 0 ? (
          <div className="h-full flex items-center justify-center px-4">
            <div className="text-center max-w-2xl">
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
                myEcho
              </h1>
              <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">
                Wie kann ich Ihnen heute helfen?
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 md:py-8">
            {chat.messages.map((message, index) => (
              <Message key={index} message={message} />
            ))}
            {isTyping && (
              <Message
                message={{ role: 'assistant', content: '' }}
                isTyping={true}
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-[#212121]">
        <div className="max-w-3xl mx-auto px-3 md:px-4 py-3 md:py-4">
          <div className="relative flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nachricht senden..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2f2f2f] px-3 md:px-4 py-2.5 md:py-3 text-sm md:text-base text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:focus:ring-sky-500 focus:border-sky-400 dark:focus:border-sky-500 max-h-32 transition-colors"
              style={{ minHeight: '44px' }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-2.5 md:p-3 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-black hover:bg-sky-600 dark:hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0 touch-manipulation"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-2 md:mt-3">
            myEcho kann Fehler machen. Überprüfen Sie wichtige Informationen.
          </p>
        </div>
      </div>
    </div>
  );
}