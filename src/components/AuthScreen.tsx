import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  KeyRound,
  MessageSquare,
  Smartphone,
} from 'lucide-react';
import {
  Profile,
  isSupabaseConfigured,
  normalizePhone,
  supabase,
  translateAuthError,
  usernameToSyntheticEmail,
} from '../supabaseClient';
import {
  authenticateLocalAccount,
  authenticateLocalPhone,
  createLocalAccount,
} from '../previewStore';
import { MobileInstallBanner, PWAInstallButton } from './PWAInstallButton';
import { MarLogo } from './MarLogo';

interface AuthScreenProps {
  onAuthenticated: (displayName?: string) => void;
  onPreviewLogin: (profile: Profile) => void;
}

type AuthTab = 'phone' | 'password';
type AuthAction = 'login' | 'register';

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
  onPreviewLogin,
}) => {
  const [tab, setTab] = useState<AuthTab>('password');
  const [action, setAction] = useState<AuthAction>('login');

  // Opción 1: Teléfono móvil
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  // Opción 2: Contraseña simple
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Nombre solo al registrarse
  const [displayName, setDisplayName] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const markImageFailed = (src: string) => {
    setFailedImages((prev) => ({ ...prev, [src]: true }));
  };

  const handleSimpleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedUser = username.trim();
    if (trimmedUser.length < 3) {
      setError('Tu usuario debe tener al menos 3 letras o números.');
      return;
    }
    if (password.length < 6) {
      setError('Tu contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (action === 'register' && displayName.trim().length < 2) {
      setError('Ingresa tu nombre para que tu equipo te reconozca.');
      return;
    }

    if (!isSupabaseConfigured) {
      if (action === 'register') {
        const res = createLocalAccount({
          name: displayName.trim(),
          credential: trimmedUser,
          password,
          role: 'member',
        });
        if (res.error || !res.account) {
          setError(res.error || 'No se pudo crear la cuenta.');
          return;
        }
        onPreviewLogin({
          id: res.account.id,
          name: res.account.name,
          role: res.account.role,
          status: res.account.status,
        });
        return;
      }

      const matched = authenticateLocalAccount(trimmedUser, password);
      if (!matched) {
        setError('Usuario o contraseña incorrectos.');
        return;
      }
      onPreviewLogin({
        id: matched.id,
        name: matched.name,
        role: matched.role,
        status: matched.status,
      });
      return;
    }

    const email = usernameToSyntheticEmail(trimmedUser);
    setLoading(true);

    try {
      if (action === 'register') {
        const finalName = displayName.trim();
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: finalName, username: trimmedUser },
          },
        });
        if (signUpError) throw signUpError;
        if (data.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            name: finalName,
          });
        }
        if (!data.session) {
          setNotice('Cuenta creada. Ya puedes iniciar sesión.');
        } else {
          onAuthenticated(finalName);
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        const fallbackName =
          (data.user?.user_metadata?.name as string | undefined) || trimmedUser;
        onAuthenticated(fallbackName);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No pudimos iniciar tu sesión.';
      setError(translateAuthError(msg));
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const formattedPhone = normalizePhone(phone);
    if (formattedPhone.length < 8) {
      setError('Ingresa un número válido con código de país (ej. +51 999 888 777).');
      return;
    }

    if (!isSupabaseConfigured) {
      if (action === 'register') {
        if (displayName.trim().length < 2) {
          setError('Ingresa tu nombre para que tu equipo te reconozca.');
          return;
        }
        const res = createLocalAccount({
          name: displayName.trim(),
          credential: formattedPhone,
          password: otpCode.trim() || '123456',
          role: 'member',
        });
        if (res.error || !res.account) {
          setError(res.error || 'No se pudo registrar el número.');
          return;
        }
        onPreviewLogin({
          id: res.account.id,
          name: res.account.name,
          role: res.account.role,
          status: res.account.status,
        });
        return;
      }

      const matched = authenticateLocalPhone(formattedPhone);
      if (!matched) {
        setError('Número no registrado. Pide a Root que cree tu usuario o crea tu cuenta.');
        return;
      }
      onPreviewLogin({
        id: matched.id,
        name: matched.name,
        role: matched.role,
        status: matched.status,
      });
      return;
    }

    setLoading(true);
    try {
      if (!otpSent) {
        if (action === 'register' && displayName.trim().length < 2) {
          setError('Ingresa tu nombre para que tu equipo te reconozca.');
          setLoading(false);
          return;
        }
        const { error: otpErr } = await supabase.auth.signInWithOtp({
          phone: formattedPhone,
          options: {
            data: displayName.trim() ? { name: displayName.trim() } : undefined,
          },
        });
        if (otpErr) throw otpErr;
        setOtpSent(true);
        setNotice(`Código enviado al ${formattedPhone}.`);
      } else {
        if (otpCode.trim().length < 4) {
          setError('Ingresa el código que recibiste.');
          setLoading(false);
          return;
        }
        const { data, error: verifyErr } = await supabase.auth.verifyOtp({
          phone: formattedPhone,
          token: otpCode.trim(),
          type: 'sms',
        });
        if (verifyErr) throw verifyErr;
        const finalName =
          displayName.trim() ||
          (data.user?.user_metadata?.name as string | undefined) ||
          '';
        if (data.user && finalName) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            name: finalName,
          });
        }
        onAuthenticated(finalName || undefined);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No pudimos verificar tu número.';
      setError(translateAuthError(msg));
    } finally {
      setLoading(false);
    }
  };

  const heroImg = '/src/assets/images/real_team_hero_1795460870490.jpg';
  const pairImg = '/src/assets/images/real_team_pair_1795460870902.jpg';
  const mobileImg = '/src/assets/images/real_team_mobile_1795460871496.jpg';

  return (
    <div className="min-h-dvh lg:h-screen lg:overflow-hidden flex flex-col bg-[#F5F3FF] dark:bg-[#1E1B4B] text-[#1E1B4B] dark:text-[#F5F3FF]">
      <MobileInstallBanner />
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
      {/* Panel visual izquierdo (#1E1B4B con brillos #8B5CF6 y #5B21B6) */}
      <div className="relative lg:w-[55%] xl:w-[57%] bg-[#1E1B4B] text-[#F5F3FF] flex flex-col justify-between p-5 sm:p-8 lg:p-10 overflow-hidden shrink-0">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-[#8B5CF6]/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-[#5B21B6]/40 blur-3xl"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 -right-20 w-72 h-72 rounded-full bg-[#FF8A1F]/15 blur-3xl"
        />

        {/* Marca superior */}
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <MarLogo size={38} className="shadow-md shadow-black/25 shrink-0" />
            <span className="text-xl font-bold font-display tracking-tight text-white">
              MAR
            </span>
          </div>

          <div className="lg:hidden">
            <PWAInstallButton variant="compact" />
          </div>
        </div>

        {/* Mosaico visual central con fotos reales */}
        <div className="relative z-10 my-4 lg:my-auto grid grid-cols-2 gap-3 sm:gap-4 max-w-2xl w-full mx-auto">
          <div className="col-span-2 rounded-2xl overflow-hidden ring-1 ring-[#DDD6FE]/25 shadow-2xl shadow-[#0E0B2B]/70 bg-[#292466]">
            {!failedImages[heroImg] ? (
              <img
                src={heroImg}
                alt="Equipo sonriendo y colaborando frente a una laptop en una oficina moderna"
                referrerPolicy="no-referrer"
                onError={() => markImageFailed(heroImg)}
                className="w-full h-44 sm:h-56 lg:h-[31vh] xl:h-[34vh] object-cover object-center block"
              />
            ) : (
              <div className="w-full h-44 sm:h-56 lg:h-[31vh] flex items-center justify-center">
                <MessageSquare className="w-12 h-12 text-[#8B5CF6]" />
              </div>
            )}
          </div>

          <div className="hidden sm:block rounded-2xl overflow-hidden ring-1 ring-[#DDD6FE]/25 shadow-xl shadow-[#0E0B2B]/60 bg-[#292466]">
            {!failedImages[pairImg] ? (
              <img
                src={pairImg}
                alt="Dos compañeros revisando avances de proyecto"
                referrerPolicy="no-referrer"
                onError={() => markImageFailed(pairImg)}
                className="w-full h-28 lg:h-[18vh] xl:h-[20vh] object-cover object-center block"
              />
            ) : (
              <div className="w-full h-28 lg:h-[18vh] flex items-center justify-center">
                <MessageSquare className="w-8 h-8 text-[#DDD6FE]" />
              </div>
            )}
          </div>

          <div className="hidden sm:block rounded-2xl overflow-hidden ring-1 ring-[#DDD6FE]/25 shadow-xl shadow-[#0E0B2B]/60 bg-[#292466]">
            {!failedImages[mobileImg] ? (
              <img
                src={mobileImg}
                alt="Integrante del equipo respondiendo mensajes desde su celular"
                referrerPolicy="no-referrer"
                onError={() => markImageFailed(mobileImg)}
                className="w-full h-28 lg:h-[18vh] xl:h-[20vh] object-cover object-center block"
              />
            ) : (
              <div className="w-full h-28 lg:h-[18vh] flex items-center justify-center">
                <Smartphone className="w-8 h-8 text-[#8B5CF6]" />
              </div>
            )}
          </div>
        </div>

        {/* Titular breve */}
        <div className="relative z-10 max-w-xl mx-auto w-full flex items-center justify-between gap-4">
          <h1 className="text-xl sm:text-2xl lg:text-[1.75rem] font-bold font-display leading-tight text-white">
            Tu equipo conectado, en un solo lugar.
          </h1>
          <span className="hidden xl:inline-flex items-center gap-2 text-xs font-medium text-[#DDD6FE] whitespace-nowrap shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#10B981]" />
            En vivo
          </span>
        </div>
      </div>

      {/* Panel derecho: Acceso directo limpio */}
      <div className="flex-1 flex flex-col justify-between p-5 sm:p-8 lg:p-10 bg-[#F5F3FF] dark:bg-[#151238]">
        <div className="hidden lg:flex items-center justify-end min-h-[40px]">
          <PWAInstallButton variant="surface" />
        </div>

        <div className="w-full max-w-md mx-auto my-auto">
          <div className="rounded-2xl border border-[#DDD6FE] dark:border-[#312E81] bg-white dark:bg-[#1E1B4B] p-6 sm:p-8 shadow-xl shadow-[#5B21B6]/10 dark:shadow-black/40">
            <div className="flex items-center gap-2.5 mb-5">
              <span className="w-1.5 h-6 rounded-full bg-[#FF8A1F] shrink-0" aria-hidden="true" />
              <h2 className="text-2xl font-bold font-display tracking-tight text-[#1E1B4B] dark:text-[#F5F3FF]">
                {action === 'login' ? 'Entra a tu espacio' : 'Crea tu cuenta'}
              </h2>
            </div>

            {/* Selector estricto de 2 opciones */}
            <div
              role="tablist"
              aria-label="Método de acceso"
              className="grid grid-cols-2 gap-1 rounded-xl bg-[#F5F3FF] dark:bg-[#151238] p-1 border border-[#DDD6FE] dark:border-[#312E81]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'phone'}
                onClick={() => {
                  setTab('phone');
                  setError(null);
                  setNotice(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
                  tab === 'phone'
                    ? 'bg-white dark:bg-[#5B21B6] text-[#5B21B6] dark:text-white shadow-sm'
                    : 'text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75 hover:text-[#1E1B4B] dark:hover:text-white'
                }`}
              >
                <Smartphone className="w-4 h-4 shrink-0" />
                <span>Teléfono</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'password'}
                onClick={() => {
                  setTab('password');
                  setError(null);
                  setNotice(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
                  tab === 'password'
                    ? 'bg-white dark:bg-[#5B21B6] text-[#5B21B6] dark:text-white shadow-sm'
                    : 'text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75 hover:text-[#1E1B4B] dark:hover:text-white'
                }`}
              >
                <KeyRound className="w-4 h-4 shrink-0" />
                <span>Contraseña</span>
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 p-3 text-xs text-red-700 dark:text-red-200 leading-relaxed"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div
                role="status"
                className="mt-4 rounded-xl border border-[#DDD6FE] dark:border-[#8B5CF6]/40 bg-[#F5F3FF] dark:bg-[#5B21B6]/25 p-3 text-xs text-[#5B21B6] dark:text-[#DDD6FE] leading-relaxed font-medium"
              >
                {notice}
              </div>
            )}

            {tab === 'phone' ? (
              <form onSubmit={handlePhoneSubmit} className="mt-5 space-y-4">
                {action === 'register' && !otpSent && (
                  <div>
                    <label
                      htmlFor="phone-display-name"
                      className="block text-xs font-semibold text-[#1E1B4B] dark:text-[#DDD6FE] mb-1.5"
                    >
                      Tu nombre
                    </label>
                    <input
                      id="phone-display-name"
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Ej. Carlos Ruiz"
                      className="w-full rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#151238] px-4 py-3 text-base sm:text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:bg-white dark:focus:bg-[#191645] focus:border-[#8B5CF6] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/25"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="phone-number"
                    className="block text-xs font-semibold text-[#1E1B4B] dark:text-[#DDD6FE] mb-1.5"
                  >
                    Número de celular
                  </label>
                  <input
                    id="phone-number"
                    type="tel"
                    required
                    disabled={otpSent}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+51 999 888 777"
                    className="w-full rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#151238] px-4 py-3 text-base sm:text-sm font-mono tabular-nums text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 disabled:opacity-60 focus:bg-white dark:focus:bg-[#191645] focus:border-[#8B5CF6] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/25"
                  />
                </div>

                {otpSent && (
                  <div>
                    <label
                      htmlFor="phone-otp"
                      className="block text-xs font-semibold text-[#1E1B4B] dark:text-[#DDD6FE] mb-1.5"
                    >
                      Código de verificación
                    </label>
                    <input
                      id="phone-otp"
                      type="text"
                      inputMode="numeric"
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="123456"
                      className="w-full rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#151238] px-4 py-3 text-base sm:text-sm font-mono tracking-widest tabular-nums text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:bg-white dark:focus:bg-[#191645] focus:border-[#8B5CF6] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/25"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B21B6] hover:bg-[#4C1D95] disabled:opacity-60 py-3 px-5 text-sm font-semibold text-white transition-colors min-h-[48px]"
                >
                  <span>
                    {loading
                      ? 'Un momento...'
                      : otpSent
                      ? 'Confirmar y entrar'
                      : 'Continuar'}
                  </span>
                  {!loading && <ArrowRight className="w-4 h-4 shrink-0" />}
                </button>

                {otpSent && (
                  <button
                    type="button"
                    onClick={() => {
                      setOtpSent(false);
                      setOtpCode('');
                      setNotice(null);
                    }}
                    className="w-full text-center text-xs text-[#5B21B6] dark:text-[#DDD6FE] font-semibold hover:underline pt-1"
                  >
                    Cambiar número
                  </button>
                )}
              </form>
            ) : (
              <form onSubmit={handleSimpleAuth} className="mt-5 space-y-4">
                {action === 'register' && (
                  <div>
                    <label
                      htmlFor="display-name"
                      className="block text-xs font-semibold text-[#1E1B4B] dark:text-[#DDD6FE] mb-1.5"
                    >
                      Tu nombre
                    </label>
                    <input
                      id="display-name"
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Ej. Laura Mendoza"
                      className="w-full rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#151238] px-4 py-3 text-base sm:text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:bg-white dark:focus:bg-[#191645] focus:border-[#8B5CF6] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/25"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="simple-username"
                    className="block text-xs font-semibold text-[#1E1B4B] dark:text-[#DDD6FE] mb-1.5"
                  >
                    Usuario
                  </label>
                  <input
                    id="simple-username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ej. laura.m"
                    className="w-full rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#151238] px-4 py-3 text-base sm:text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:bg-white dark:focus:bg-[#191645] focus:border-[#8B5CF6] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/25"
                  />
                </div>

                <div>
                  <label
                    htmlFor="simple-password"
                    className="block text-xs font-semibold text-[#1E1B4B] dark:text-[#DDD6FE] mb-1.5"
                  >
                    Contraseña
                  </label>
                  <input
                    id="simple-password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete={action === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Al menos 6 caracteres"
                    className="w-full rounded-xl border border-[#DDD6FE] dark:border-[#312E81] bg-[#F5F3FF]/60 dark:bg-[#151238] px-4 py-3 text-base sm:text-sm text-[#1E1B4B] dark:text-white placeholder:text-[#1E1B4B]/40 dark:placeholder:text-[#DDD6FE]/45 focus:bg-white dark:focus:bg-[#191645] focus:border-[#8B5CF6] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/25"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B21B6] hover:bg-[#4C1D95] disabled:opacity-60 py-3 px-5 text-sm font-semibold text-white transition-colors min-h-[48px]"
                >
                  <span>
                    {loading
                      ? 'Un momento...'
                      : action === 'login'
                      ? 'Entrar'
                      : 'Crear cuenta'}
                  </span>
                  {!loading && <ArrowRight className="w-4 h-4 shrink-0" />}
                </button>
              </form>
            )}



            <div className="mt-5 pt-4 border-t border-[#DDD6FE] dark:border-[#312E81] text-center text-sm text-[#1E1B4B]/70 dark:text-[#DDD6FE]/80">
              {action === 'login' ? (
                <span>
                  ¿Primera vez aquí?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAction('register');
                      setError(null);
                      setNotice(null);
                      setOtpSent(false);
                    }}
                    className="font-semibold text-[#5B21B6] dark:text-[#8B5CF6] hover:underline"
                  >
                    Crea tu cuenta
                  </button>
                </span>
              ) : (
                <span>
                  ¿Ya tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAction('login');
                      setError(null);
                      setNotice(null);
                      setOtpSent(false);
                    }}
                    className="font-semibold text-[#5B21B6] dark:text-[#8B5CF6] hover:underline"
                  >
                    Inicia sesión
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="hidden lg:block min-h-[20px]" />
      </div>
      </div>
    </div>
  );
};
