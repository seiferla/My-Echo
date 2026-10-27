import React, { useRef } from 'react';
import {
    View,
    ScrollView,
    ScrollViewInstance,
    TouchableOpacity,
    TextInput,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Send, X, Save, Check, Zap, Leaf } from 'lucide-react-native';

interface ComposeModalProps {
    visible: boolean;
    /** Edit mode shows only Check (save the edit); compose mode shows Save (silent) and Send (spoken). */
    isEditMode: boolean;
    value: string;
    onChangeText: (text: string) => void;
    fastMode: boolean;
    onToggleFastMode: () => void;
    onClose: () => void;
    onSave: () => void;
    onSend: () => void;
    onSaveEdit: () => void;
}

/** Full-screen editor for writing a new message or editing an existing one. */
export function ComposeModal({
    visible,
    isEditMode,
    value,
    onChangeText,
    fastMode,
    onToggleFastMode,
    onClose,
    onSave,
    onSend,
    onSaveEdit,
}: ComposeModalProps) {
    const composeScrollRef = useRef<ScrollViewInstance>(null);
    const isEmpty = !value.trim();

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="fullScreen"
        >
            {/* Only top/left/right: no bottom padding, so the TextInput uses the full height */}
            <SafeAreaView style={styles.modalContainer} edges={['top', 'left', 'right']}>
                <View style={styles.modalHeader}>
                    <TouchableOpacity onPress={onClose} style={styles.modalButton}>
                        <X size={32} color="#4b5563" />
                    </TouchableOpacity>
                    {!isEditMode && (
                        // Icon only, same size as the other header buttons: a wide
                        // text/switch pushed the send button off small screens.
                        // Lightning = fast, leaf = eco.
                        <TouchableOpacity
                            onPress={onToggleFastMode}
                            style={[styles.modalButton, { backgroundColor: fastMode ? '#e0f2fe' : '#dcfce7' }]}
                            activeOpacity={0.7}
                            accessibilityRole="switch"
                            accessibilityState={{ checked: fastMode }}
                            accessibilityLabel={fastMode ? 'Schnell-Modus an' : 'Eco-Modus an'}
                        >
                            {fastMode ? <Zap size={32} color="#0ea5e9" /> : <Leaf size={32} color="#16a34a" />}
                        </TouchableOpacity>
                    )}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                        {isEditMode ? (
                            // Edit mode: only Check (save)
                            <TouchableOpacity
                                onPress={onSaveEdit}
                                disabled={isEmpty}
                                style={[styles.modalButton, styles.saveButton, isEmpty && styles.disabledButton]}
                            >
                                <Check size={32} color="white" />
                            </TouchableOpacity>
                        ) : (
                            // Compose mode: Save (silent) + Send (spoken)
                            <>
                                <TouchableOpacity
                                    onPress={onSave}
                                    disabled={isEmpty}
                                    style={[styles.modalButton, styles.saveButton, isEmpty && styles.disabledButton]}
                                >
                                    <Save size={32} color="white" />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={onSend}
                                    disabled={isEmpty}
                                    style={[styles.modalButton, styles.sendButton, isEmpty && styles.disabledButton]}
                                >
                                    <Send size={32} color="white" />
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>

                {/* Moves the content up when the keyboard opens */}
                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                {/* ScrollView follows the cursor; the TextInput grows with the text */}
                <ScrollView
                    ref={composeScrollRef}
                    style={styles.composeScroll}
                    keyboardShouldPersistTaps="handled"
                    onContentSizeChange={() =>
                        composeScrollRef.current?.scrollToEnd({ animated: false })
                    }
                >
                    <TextInput
                        style={styles.modalInput}
                        value={value}
                        onChangeText={onChangeText}
                        placeholder={isEditMode ? "Nachricht bearbeiten..." : "Nachricht eingeben..."}
                        placeholderTextColor="#9ca3af"
                        multiline
                        autoFocus
                        textAlignVertical="top"
                        scrollEnabled={false}
                    />
                </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalContainer: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    modalButton: {
        padding: 10,
        borderRadius: 30,
    },
    sendButton: {
        backgroundColor: '#0ea5e9',
    },
    saveButton: {
        backgroundColor: '#10b981',
    },
    disabledButton: {
        opacity: 0.4,
    },
    composeScroll: {
        flex: 1,
    },
    modalInput: {
        minHeight: 200,
        padding: 20,
        fontSize: 32,
        color: '#111827',
        fontWeight: '500',
    },
});
