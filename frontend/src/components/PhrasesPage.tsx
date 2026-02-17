import {ArrowLeft, Copy, Check} from 'lucide-react';
import {useNavigate} from 'react-router';
import {useState, useEffect} from 'react';

export function PhrasesPage() {
  const navigate = useNavigate();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [phrases, setPhrases] = useState<string[]>([]);

  useEffect(() => {
    // Lade Chats aus localStorage
    const savedChats = localStorage.getItem('myEchoChats');
    if (savedChats) {
      const chats = JSON.parse(savedChats);
      const extractedPhrases = extractFrequentPhrases(chats);
      setPhrases(extractedPhrases);
    } else {
      // Beispiel-Phrasen wenn keine Chats vorhanden sind
      setPhrases([
        'Guten Morgen',
        'Wie geht es dir?',
        'Danke für deine Hilfe',
        'Bis bald',
        'Alles klar',
        'Verstanden',
        'Kein Problem',
        'Sehr gut',
      ]);
    }
  }, []);

  const extractFrequentPhrases = (chats: any[]) => {
    const phraseCount: { [key: string]: number } = {};

    // Sammle alle User-Nachrichten
    chats.forEach(chat => {
      chat.messages?.forEach((message: any) => {
        if (message.role === 'user') {
          const content = message.content.trim();
          if (content.length > 0 && content.length < 100) {
            phraseCount[content] = (phraseCount[content] || 0) + 1;
          }
        }
      });
    });

    // Sortiere nach Häufigkeit und nimm die Top 20
    return Object.entries(phraseCount)
        .sort(([, a], [, b]) => b - a)
        .filter(phraseCount => phraseCount[1] > 3)
        .slice(0, 20)
        .map(([phrase]) => phrase);
  };

  const copyToClipboard = (phrase: string, index: number) => {
    navigator.clipboard.writeText(phrase);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const speechSynthesis = (phrase: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.lang = 'de-DE';
      window.speechSynthesis.speak(utterance);
    }
  }

  return (
      <div className="flex flex-col h-screen bg-white dark:bg-[#212121]">
        <header
            className="flex items-center gap-3 px-3 md:px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <button
              onClick={() => navigate('/')}
              className="p-2 hover:bg-sky-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700 dark:text-gray-300"/>
          </button>
          <div className="flex-1">
            <h1 className="text-lg md:text-xl font-semibold text-gray-800 dark:text-gray-200">
              Häufige Phrasen
            </h1>
            <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">
              Ihre am häufigsten verwendeten Nachrichten
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-3 md:px-4 py-4 md:py-6">
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {phrases.map((phrase, index) => (
                <button
                    key={index}
                    onClick={() => speechSynthesis(phrase)}
                    className="group relative flex items-center justify-between gap-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2f2f2f] hover:border-sky-400 dark:hover:border-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-all touch-manipulation"
                >
              <span
                  className="text-sm md:text-base text-gray-800 dark:text-gray-200 text-left flex-1">
                {phrase}
              </span>
                  <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(phrase, index);
                      }}
                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors"
                      aria-label="Kopieren"
                  >
                    {copiedIndex === index ? (
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0"/>
                    ) : (
                        <Copy
                            className="w-4 h-4 text-gray-400 group-hover:text-sky-600 dark:group-hover:text-sky-400 flex-shrink-0 transition-colors"/>
                    )}
                  </button>
                </button>
            ))}
          </div>

          {phrases.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400">
                  Noch keine Phrasen vorhanden. Senden Sie Nachrichten, um häufige Phrasen zu
                  sammeln.
                </p>
              </div>
          )}
        </div>
      </div>
  );
}