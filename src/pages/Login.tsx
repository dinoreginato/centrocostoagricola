
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Loader2 } from 'lucide-react';
import { resetPasswordForEmail, signInWithEmail, signUpWithEmail } from '../services/auth';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (isResetPassword) {
        await resetPasswordForEmail({ email, redirectTo: window.location.origin });
        setMessage('Revisa tu correo para el enlace de recuperación.');
      } else if (isSignUp) {
        const data = await signUpWithEmail({ email, password });
        if (data.user && data.session) {
            navigate('/');
        } else {
            setMessage('Registro exitoso. Por favor revisa tu correo para confirmar tu cuenta.');
        }
      } else {
        await signInWithEmail({ email, password });
        navigate('/');
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      if (err.message === 'Failed to fetch') {
        setError('Error de conexión con el servidor. Posible bloqueo de red o configuración de dominio (CORS) en Supabase.');
      } else if (err.message.includes('Invalid login credentials')) {
        setError('Correo o contraseña incorrectos.');
      } else {
        setError(err.message || 'Error de autenticación');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            Centro de Costo Agrícola
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            {isResetPassword 
              ? 'Ingresa tu correo para recuperar tu contraseña'
              : isSignUp 
                ? 'Crea una cuenta para comenzar' 
                : 'Inicia sesión para gestionar tu campo'}
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleAuth}>
          <input type="hidden" name="remember" value="true" />
          <div className="rounded-md shadow-sm -space-y-px">
            <div className="relative">
              <Mail className="absolute top-3 left-3 h-5 w-5 text-gray-400" />
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={`appearance-none rounded-none ${isResetPassword ? 'rounded-md' : 'rounded-t-md'} relative block w-full px-10 py-2 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-green-500 focus:border-green-500 focus:z-10 sm:text-sm`}
                placeholder="Correo electrónico"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {!isResetPassword && (
              <div className="relative">
                <Lock className="absolute top-3 left-3 h-5 w-5 text-gray-400" />
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="appearance-none rounded-none rounded-b-md relative block w-full px-10 py-2 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-green-500 focus:border-green-500 focus:z-10 sm:text-sm"
                  placeholder="Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
          </div>

          {error && (
            <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded">
              {error}
            </div>
          )}

          {message && (
            <div className="text-green-600 text-sm text-center bg-green-50 p-2 rounded">
              {message}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                isResetPassword 
                  ? 'Enviar correo de recuperación'
                  : isSignUp ? 'Registrarse' : 'Ingresar'
              )}
            </button>
          </div>
          
          <div className="text-center mt-4 space-y-2">
            <button
              type="button"
              onClick={() => {
                if (isResetPassword) {
                  setIsResetPassword(false);
                } else {
                  setIsSignUp(!isSignUp);
                }
                setError(null);
                setMessage(null);
              }}
              className="text-sm text-green-600 hover:text-green-500 font-medium block w-full"
            >
              {isResetPassword
                ? 'Volver al inicio de sesión'
                : isSignUp 
                  ? '¿Ya tienes cuenta? Inicia sesión aquí' 
                  : '¿No tienes cuenta? Regístrate aquí'}
            </button>
            
            {!isResetPassword && !isSignUp && (
              <button
                type="button"
                onClick={() => {
                  setIsResetPassword(true);
                  setError(null);
                  setMessage(null);
                }}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300 font-medium block w-full"
              >
                ¿Olvidaste tu contraseña?
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
