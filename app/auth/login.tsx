import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DismissKeyboardView from '../components/DismissKeyboardView';
import { useAuth } from '../../contexts/AuthContext';
import { signInWithGoogle } from '../../lib/googleAuth';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const passwordInputRef = useRef<TextInput>(null);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Fyll i e-post och lösenord.');
      shake();
      return;
    }
    setLoading(true);
    setError('');
    const { error: err } = await signIn(email.trim(), password);
    setLoading(false);
    if (err) {
      setError('Fel e-post eller lösenord.');
      shake();
    } else {
      router.replace('/(tabs)' as never);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError('');
    const { error: err } = await signInWithGoogle();
    setGoogleLoading(false);
    if (err) {
      setError(err);
      shake();
    }
    // Vid framgång hanteras navigation av auth-gate i _layout.tsx
  };

  const handleContinueAsGuest = async () => {
    setGuestLoading(true);
    setError('');
    const randomId = Math.random().toString(36).slice(2, 10);
    const guestEmail = `testare-${randomId}@pauseapp-test.se`;
    const guestPassword = `${Math.random().toString(36).slice(2, 12)}Aa1!`;
    const guestUsername = `Testare${randomId.slice(0, 5)}`;
    const { error: err, needsConfirmation } = await signUp(guestEmail, guestPassword, guestUsername);
    setGuestLoading(false);
    if (err) {
      setError('Kunde inte skapa testkonto: ' + err);
      shake();
    } else if (needsConfirmation) {
      setError('E-postbekräftelse krävs just nu i Supabase-inställningarna, så testkonton kan inte logga in direkt.');
      shake();
    }
    // Vid framgång hanteras navigation av auth-gate i _layout.tsx
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <DismissKeyboardView>
      <View style={styles.inner}>
        <View style={styles.logoRow}>
          <FontAwesome name="pause" size={22} color="#2e86de" />
          <Text style={styles.logoText}>PAUSE POD</Text>
        </View>

        <View style={styles.header}>
          <Text style={styles.title}>{'\n'}Välkommen.</Text>
          <Text style={styles.subtitle}>Logga in för att fortsätta.</Text>
        </View>

        <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
          <TextInput
            style={styles.input}
            placeholder="E-postadress"
            placeholderTextColor="#4a4a6a"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordInputRef.current?.focus()}
          />
          <TextInput
            ref={passwordInputRef}
            style={styles.input}
            placeholder="Lösenord"
            placeholderTextColor="#4a4a6a"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </Animated.View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading || googleLoading}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>{loading ? 'Loggar in...' : 'Logga in'}</Text>
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>eller</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[styles.googleButton, googleLoading && styles.buttonDisabled]}
          onPress={handleGoogleSignIn}
          disabled={loading || googleLoading}
          activeOpacity={0.85}
        >
          <Text style={styles.googleG}>G</Text>
          <Text style={styles.googleText}>
            {googleLoading ? 'Ansluter...' : 'Fortsätt med Google'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/auth/signup' as never)} style={styles.switchRow}>
          <Text style={styles.switchText}>Inget konto? </Text>
          <Text style={styles.switchLink}>Skapa ett</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleContinueAsGuest}
          style={[styles.guestButton, guestLoading && styles.buttonDisabled]}
          disabled={loading || googleLoading || guestLoading}
          activeOpacity={0.85}
        >
          <Text style={styles.guestButtonText}>
            {guestLoading ? 'Skapar testkonto...' : 'Fortsätt utan att logga in'}
          </Text>
        </TouchableOpacity>
      </View>
      </DismissKeyboardView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 80,
    paddingBottom: 48,
    justifyContent: 'center',
    gap: 24,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
  },
  logoText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2e86de',
    letterSpacing: 4,
  },
  header: {
    gap: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#ffffff',
    lineHeight: 44,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 16,
    color: '#5a7fa8',
    letterSpacing: 0.2,
  },
  form: {
    gap: 12,
  },
  input: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#1e2a3a',
  },
  errorText: {
    color: '#e05a5a',
    fontSize: 14,
    marginTop: 4,
  },
  button: {
    backgroundColor: '#2e86de',
    borderRadius: 32,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#2e86de',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1e2a3a',
  },
  dividerText: {
    color: '#3a3a5a',
    fontSize: 13,
    letterSpacing: 1,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#1a1a2e',
    borderRadius: 32,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: '#2a2a4a',
  },
  googleG: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8a9aba',
    letterSpacing: 0,
  },
  googleText: {
    color: '#8a9aba',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  switchText: {
    color: '#4a4a6a',
    fontSize: 14,
  },
  switchLink: {
    color: '#2e86de',
    fontSize: 14,
    fontWeight: '600',
  },
  guestButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2a2a4a',
    marginTop: 4,
  },
  guestButtonText: {
    color: '#8a9aba',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
