import { useState, useRef, useEffect } from 'react';
import { Bot, Volume2, Pause, Pencil, Check, X } from 'lucide-react';

interface MessageProps {
    message: {
        role: 'user' | 'assistant';
        content: string;
    };
    isTyping?: boolean;
    onEdit?: (newContent: string) => void;
    autoPlay?: boolean;
}

export function Message({ message, isTyping, onEdit, autoPlay }: MessageProps) {
    const isUser = message.role === 'user';

    // TTS state
    const [isPlaying, setIsPlaying] = useState(false);
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

    // Edit state
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState(message.content);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-play on mount if requested
    useEffect(() => {
        if (autoPlay && isUser && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(message.content);
            utterance.lang = 'de-DE';
            utterance.onend = () => setIsPlaying(false);
            utterance.onerror = () => setIsPlaying(false);
            utteranceRef.current = utterance;
            setIsPlaying(true);
            window.speechSynthesis.speak(utterance);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync editText when message content changes externally
    useEffect(() => {
        if (!isEditing) {
            setEditText(message.content);
        }
    }, [message.content, isEditing]);

    // Auto-resize textarea
    useEffect(() => {
        if (isEditing && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
            // Move cursor to end
            const len = textareaRef.current.value.length;
            textareaRef.current.setSelectionRange(len, len);
        }
    }, [isEditing]);

    // Cleanup TTS on unmount
    useEffect(() => {
        return () => {
            if (utteranceRef.current) {
                window.speechSynthesis.cancel();
            }
        };
    }, []);

    const handleSpeak = () => {
        if (!('speechSynthesis' in window)) return;

        if (isPlaying) {
            window.speechSynthesis.cancel();
            setIsPlaying(false);
            return;
        }

        // Cancel any other ongoing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(message.content);
        utterance.lang = 'de-DE';
        utterance.onend = () => setIsPlaying(false);
        utterance.onerror = () => setIsPlaying(false);
        utteranceRef.current = utterance;

        setIsPlaying(true);
        window.speechSynthesis.speak(utterance);
    };

    const handleEditSave = () => {
        if (editText.trim() && onEdit) {
            onEdit(editText.trim());
        }
        setIsEditing(false);
    };

    const handleEditCancel = () => {
        setEditText(message.content);
        setIsEditing(false);
    };

    const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleEditSave();
        }
        if (e.key === 'Escape') {
            handleEditCancel();
        }
    };

    return (
        <div
            className={`py-4 md:py-6 px-2 md:px-4 group/msg ${
                isUser ? 'bg-white dark:bg-[#212121]' : 'bg-gray-50 dark:bg-[#2f2f2f]'
            }`}
        >
            <div className="max-w-3xl mx-auto flex gap-3 md:gap-4">
                {/* Left icon – speaker for user, bot avatar for assistant */}
                {isUser ? (
                    <button
                        onClick={handleSpeak}
                        className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all touch-manipulation ${
                            isPlaying
                                ? 'bg-sky-500 text-white hover:bg-sky-600'
                                : 'bg-gradient-to-br from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600'
                        }`}
                        title={isPlaying ? 'Wiedergabe pausieren' : 'Nachricht vorlesen'}
                    >
                        {isPlaying ? (
                            <Pause className="w-4 h-4 md:w-5 md:h-5" />
                        ) : (
                            <Volume2 className="w-4 h-4 md:w-5 md:h-5" />
                        )}
                    </button>
                ) : (
                    <div className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-sky-500 dark:bg-sky-600 text-white">
                        <Bot className="w-4 h-4 md:w-5 md:h-5" />
                    </div>
                )}

                {/* Message content */}
                <div className="flex-1 pt-0.5 md:pt-1 min-w-0">
                    {isTyping ? (
                        <div className="flex gap-1">
                            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                    ) : isEditing ? (
                        <div className="flex flex-col gap-2">
              <textarea
                  ref={textareaRef}
                  value={editText}
                  onChange={(e) => {
                      setEditText(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onKeyDown={handleEditKeyDown}
                  className="w-full resize-none rounded-lg border border-sky-400 dark:border-sky-500 bg-white dark:bg-[#2f2f2f] px-3 py-2 text-sm md:text-base text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:focus:ring-sky-500 transition-colors overflow-hidden"
                  style={{ minHeight: '44px' }}
              />
                            <div className="flex gap-2">
                                <button
                                    onClick={handleEditSave}
                                    disabled={!editText.trim()}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <Check className="w-3.5 h-3.5" />
                                    Speichern
                                </button>
                                <button
                                    onClick={handleEditCancel}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    Abbrechen
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-start gap-2">
                            <p className="flex-1 text-sm md:text-base text-gray-800 dark:text-gray-100 whitespace-pre-wrap leading-relaxed break-words">
                                {message.content}
                            </p>
                            {/* Edit button – only for user messages, visible on hover */}
                            {isUser && onEdit && (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="flex-shrink-0 mt-0.5 p-1 rounded-md text-gray-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-gray-700 opacity-0 group-hover/msg:opacity-100 transition-all"
                                    title="Nachricht bearbeiten"
                                >
                                    <Pencil className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}