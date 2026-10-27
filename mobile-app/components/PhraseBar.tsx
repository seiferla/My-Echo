import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Volume2 } from 'lucide-react-native';
import { Phrase } from '../utils/phrases';

interface PhraseBarProps {
    // Already cut to the chosen count (see PhrasesContext).
    phrases: Phrase[];
    // 'grid': empty chat, big tiles below the greeting.
    // 'strip': chat with messages, a small row above the input.
    variant: 'grid' | 'strip';
    // Global switch: on = a tap speaks at once, off = the text only goes into
    // the input. Also controls the speaker icon, so the UI matches the behavior.
    speaksInstantly: boolean;
    onSelect: (phrase: Phrase) => void;
}

export function PhraseBar({ phrases, variant, speaksInstantly, onSelect }: PhraseBarProps) {
    if (phrases.length === 0) return null;

    const isGrid = variant === 'grid';

    const renderChip = (phrase: Phrase) => (
        <TouchableOpacity
            key={phrase.id}
            onPress={() => onSelect(phrase)}
            style={[styles.chip, isGrid && styles.chipBig]}
            accessibilityRole="button"
            accessibilityLabel={
                speaksInstantly
                    ? `${phrase.text} — sofort sprechen`
                    : `${phrase.text} — in die Eingabe übernehmen`
            }
        >
            {speaksInstantly && <Volume2 size={isGrid ? 16 : 13} color="#9ca3af" />}
            <Text style={[styles.chipText, isGrid && styles.chipTextBig]} numberOfLines={1}>
                {phrase.text}
            </Text>
        </TouchableOpacity>
    );

    if (isGrid) {
        return <View style={styles.grid}>{phrases.map(renderChip)}</View>;
    }

    return (
        <View style={styles.stripWrapper}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.strip}
                keyboardShouldPersistTaps="handled"
            >
                {phrases.map(renderChip)}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    // --- Tiles in the empty chat ---
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 24,
        marginTop: 28,
        maxWidth: 600,
        alignSelf: 'center',
    },
    // --- Row above the input ---
    stripWrapper: {
        backgroundColor: '#ffffff',
    },
    strip: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 15,
        paddingTop: 10,
        paddingBottom: 6,
    },
    // Quiet design (light grey, thin border, no signal color),
    // so the phrases do not dominate the chat.
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 9,
        maxWidth: 260,
    },
    chipBig: {
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderRadius: 24,
    },
    chipText: {
        fontSize: 15,
        color: '#4b5563',
        fontWeight: '500',
    },
    chipTextBig: {
        fontSize: 18,
    },
});
