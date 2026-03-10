import {useState, useRef, useEffect} from 'react';
import {Send, X} from 'lucide-react';
import {Message} from './Message';

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

export function ChatArea({chat, onUpdateChat}: ChatAreaProps) {
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [lastSentIndex, setLastSentIndex] = useState<number | null>(null);
    const [isComposing, setIsComposing] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const overlayTextareaRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    };

    useEffect(() => {
        scrollToBottom();
    }, [chat?.messages]);

    // Auto-focus textarea when overlay opens
    useEffect(() => {
        if (isComposing && overlayTextareaRef.current) {
            overlayTextareaRef.current.focus();
        }
    }, [isComposing]);

    const handleSend = () => {
        if (!input.trim() || !chat) return;

        const userMessage: ChatMessage = {
            role: 'user',
            content: input,
        };

        const updatedMessages = [...chat.messages, userMessage];
        onUpdateChat(updatedMessages);
        setLastSentIndex(updatedMessages.length - 1);
        setInput('');
        setIsComposing(false);
    };

    const handleClose = () => {
        setIsComposing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            handleClose();
        }
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Fullscreen compose overlay */}
            {isComposing && (
                <div className="fixed inset-0 z-50 bg-white dark:bg-[#212121] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                    {/* Top bar */}
                    <div
                        className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-gray-700">
                        <button
                            onClick={handleClose}
                            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                            title="Abbrechen"
                        >
                            <X className="w-6 h-6"/>
                        </button>
                        <button
                            onClick={handleSend}
                            disabled={!input.trim()}
                            className="p-2 rounded-full bg-sky-500 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                            title="Senden"
                        >
                            <Send className="w-6 h-6"/>
                        </button>
                    </div>

                    {/* Text area */}
                    <textarea
                        ref={overlayTextareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Nachricht eingeben..."
                        className="flex-1 w-full resize-none bg-transparent px-6 py-6 text-2xl md:text-3xl text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none leading-relaxed"
                    />
                </div>
            )}

            {/* Messages list */}
            <div className="flex-1 overflow-y-auto">
                {chat?.messages.length === 0 ? (
                    <div className="h-full flex items-center justify-center px-4">
                        <div className="text-center max-w-2xl">
                            <h1 className="text-2xl md:text-4xl lg:text-5xl font-semibold text-gray-800 dark:text-gray-100 mb-2 md:mb-4">
                                myEcho
                            </h1>
                            <p className="text-xs md:text-base text-gray-600 dark:text-gray-400">
                                Wie kann ich Ihnen heute helfen?
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="max-w-3xl mx-auto px-2 md:px-4 py-2 md:py-8">
                        {chat.messages.map((message, index) => (
                            <Message
                                key={index}
                                message={message}
                                autoPlay={index === lastSentIndex && message.role === 'user'}
                                onEdit={
                                    message.role === 'user'
                                        ? (newContent) => {
                                            const updated = chat.messages.map((m, i) =>
                                                i === index ? {...m, content: newContent} : m
                                            );
                                            onUpdateChat(updated);
                                        }
                                        : undefined
                                }
                            />
                        ))}
                        {isTyping && (
                            <Message
                                message={{role: 'assistant', content: ''}}
                                isTyping={true}
                            />
                        )}
                        <div ref={messagesEndRef}/>
                    </div>
                )}
            </div>

            {/* Bottom input bar */}
            <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-[#212121]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                <div className="max-w-3xl mx-auto px-2 md:px-4 py-2 md:py-4">
                    <div className="relative flex items-center gap-1.5 md:gap-2">
                        <button
                            onClick={() => setIsComposing(true)}
                            className="flex-1 text-left resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2f2f2f] px-3 md:px-4 py-2 md:py-3 text-sm md:text-base hover:border-sky-400 dark:hover:border-sky-500 transition-colors truncate"
                        >
                            {input ? (
                                <span className="text-gray-900 dark:text-gray-100">{input}</span>
                            ) : (
                                <span className="text-gray-500 dark:text-gray-400">Nachricht senden...</span>
                            )}
                        </button>
                        <button
                            onClick={() => input.trim() ? handleSend() : setIsComposing(true)}
                            className="p-2.5 md:p-3 rounded-full bg-sky-500 hover:bg-sky-600 text-white transition-all flex-shrink-0 touch-manipulation"
                        >
                            <Send className="w-5 h-5"/>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}