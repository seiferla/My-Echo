import React, { useState, useEffect } from 'react';
import { 
    View, 
    Text, 
    TouchableOpacity, 
    ScrollView, 
    StyleSheet, 
    SafeAreaView,
    FlatList
} from 'react-native';
import { ArrowLeft, Copy, Check } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { storage } from '../utils/storage';

export default function PhrasesPage() {
    const router = useRouter();
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [phrases, setPhrases] = useState<string[]>([]);

    useEffect(() => {
        const loadPhrases = async () => {
            const savedChats = await storage.getItem('myEchoChats');
            if (savedChats) {
                const chats = JSON.parse(savedChats);
                const extractedPhrases = extractFrequentPhrases(chats);
                setPhrases(extractedPhrases);
            } else {
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
        };
        loadPhrases();
    }, []);

    const extractFrequentPhrases = (chats: any[]) => {
        const phraseCount: { [key: string]: number } = {};
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

        return Object.entries(phraseCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 20)
            .map(([phrase]) => phrase);
    };

    const copyToClipboard = async (phrase: string, index: number) => {
        await Clipboard.setStringAsync(phrase);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backButton}
                >
                    <ArrowLeft size={24} color="#374151" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>Häufige Phrasen</Text>
                    <Text style={styles.headerSubtitle}>Ihre am häufigsten verwendeten Nachrichten</Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.listContent}>
                {phrases.map((phrase, index) => (
                    <TouchableOpacity
                        key={index}
                        onPress={() => copyToClipboard(phrase, index)}
                        style={styles.phraseCard}
                    >
                        <Text style={styles.phraseText}>{phrase}</Text>
                        {copiedIndex === index ? (
                            <Check size={20} color="#10b981" />
                        ) : (
                            <Copy size={20} color="#9ca3af" />
                        )}
                    </TouchableOpacity>
                ))}

                {phrases.length === 0 && (
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>
                            Noch keine Phrasen vorhanden. Senden Sie Nachrichten, um häufige Phrasen zu sammeln.
                        </Text>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    backButton: {
        padding: 8,
        marginRight: 12,
    },
    headerTitleContainer: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#6b7280',
    },
    listContent: {
        padding: 16,
        gap: 12,
    },
    phraseCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        backgroundColor: '#ffffff',
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    phraseText: {
        fontSize: 18,
        color: '#374151',
        flex: 1,
        marginRight: 12,
    },
    emptyContainer: {
        paddingVertical: 40,
        alignItems: 'center',
    },
    emptyText: {
        textAlign: 'center',
        color: '#9ca3af',
        fontSize: 16,
    }
});
