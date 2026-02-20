import { Bot, Volume2 } from 'lucide-react';
import { useSpeech } from '../hooks/useSpeech';
import { ChatMessage } from '../types';

interface MessageProps {
  message: ChatMessage;
  isTyping?: boolean;
}

export function Message({ message, isTyping }: MessageProps) {
  const isUser = message.role === 'user';
  const { speak } = useSpeech();

  return (
    <div
      className={`py-4 md:py-6 px-2 md:px-4 ${
        isUser ? 'bg-white dark:bg-[#212121]' : 'bg-gray-50 dark:bg-[#2f2f2f]'
      }`}
    >
      <div className="max-w-3xl mx-auto flex gap-3 md:gap-4">
        {isUser ? (
          <button
            onClick={() => speak(message.content)}
            className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 transition-all touch-manipulation"
            title="Nachricht vorlesen"
          >
            <Volume2 className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        ) : (
          <div
            className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-sky-500 dark:bg-sky-600 text-white"
          >
            <Bot className="w-4 h-4 md:w-5 md:h-5" />
          </div>
        )}
        <div className="flex-1 pt-0.5 md:pt-1 min-w-0">
          {isTyping ? (
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          ) : (
            <p className="text-sm md:text-base text-gray-800 dark:text-gray-100 whitespace-pre-wrap leading-relaxed break-words">
              {message.content}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}