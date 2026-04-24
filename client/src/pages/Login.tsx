import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { isValidEmail, normalizeEmail } from "@/lib/auth-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { SiDiscord, SiGoogle } from "react-icons/si";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { hapticMedium, hapticError } from "@/lib/haptics";

type AuthTab = "login" | "signup";

function normalizePostAuthRedirect(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/";
  }

  return path;
}

export default function Login() {
  const [, navigate] = useLocation();
  const {
    login,
    signup,
    resendVerification,
    loginWithGoogle,
    loginWithDiscord,
    isAuthenticated,
    isLoading: authLoading,
  } = useAuth();
  const { toast } = useToast();

  const isNative = Capacitor.isNativePlatform();

  const [activeTab, setActiveTab] = useState<AuthTab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [signupSuccessEmail, setSignupSuccessEmail] = useState<string | null>(null);

  // Ref that holds the browserFinished listener so we can remove it on cleanup or
  // when OAuth completes.  Prevents isLoading from being stuck true if the user
  // dismisses the OAuth browser without completing sign-in.
  const browserFinishedListenerRef = useRef<{ remove: () => Promise<void> } | null>(null);

  const cleanupBrowserListener = useCallback(() => {
    void browserFinishedListenerRef.current?.remove();
    browserFinishedListenerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupBrowserListener();
    };
  }, [cleanupBrowserListener]);
  const postAuthRedirect = useMemo(() => {
    if (typeof window === "undefined") {
      return "/";
    }

    const params = new URLSearchParams(window.location.search);
    return normalizePostAuthRedirect(params.get("redirect"));
  }, []);

  const normalizedEmail = useMemo(() => normalizeEmail(email), [email]);
  const emailIsValid = useMemo(() => isValidEmail(normalizedEmail), [normalizedEmail]);
  const showEmailError = emailTouched && normalizedEmail.length > 0 && !emailIsValid;

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="login-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isAuthenticated) {
    navigate(postAuthRedirect);
    return null;
  }

  const normalizeEmailField = () => {
    setEmailTouched(true);
    setEmail((value) => normalizeEmail(value));
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (signupSuccessEmail) {
      setSignupSuccessEmail(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    normalizeEmailField();

    if (!emailIsValid) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    const result = await login(normalizedEmail, password);

    if (result.success) {
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
      navigate(postAuthRedirect);
    } else {
      toast({
        title: "Login failed",
        description: result.error || "Invalid email or password",
        variant: "destructive",
      });
    }

    setIsLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    normalizeEmailField();

    if (!emailIsValid) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure your passwords match.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    const result = await signup(normalizedEmail, password);

    if (result.success) {
      setSignupSuccessEmail(normalizedEmail);
      toast({
        title: "Account created!",
        description: "Please check your email to verify your account.",
      });
    } else {
      toast({
        title: "Signup failed",
        description: result.error || "Could not create account",
        variant: "destructive",
      });
    }

    setIsLoading(false);
  };

  const handleResendVerification = async () => {
    const targetEmail = signupSuccessEmail || normalizeEmail(email);
    if (!targetEmail) return;

    setIsResendingVerification(true);
    const result = await resendVerification(targetEmail);

    if (result.success) {
      toast({
        title: "Verification email sent",
        description: "Check your inbox for a fresh confirmation link.",
      });
    } else {
      toast({
        title: "Could not resend email",
        description: result.error || "Please try again in a minute.",
        variant: "destructive",
      });
    }

    setIsResendingVerification(false);
  };

  const handleGoogleLogin = async () => {
    void hapticMedium();
    setIsLoading(true);

    // On native, register the listener BEFORE calling loginWithGoogle so it
    // is in place before Browser.open() returns — eliminating the window
    // where browserFinished could fire without a handler.
    if (isNative) {
      const listener = await Browser.addListener("browserFinished", () => {
        setIsLoading(false);
        cleanupBrowserListener();
      });
      browserFinishedListenerRef.current = listener;
    }

    const result = await loginWithGoogle(postAuthRedirect);

    if (!result.success) {
      void hapticError();
      // Browser never opened — remove the pre-registered listener.
      cleanupBrowserListener();
      toast({
        title: "Login failed",
        description: result.error || "Could not sign in with Google",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const handleDiscordLogin = async () => {
    void hapticMedium();
    setIsLoading(true);

    // Same pre-registration pattern as Google.
    if (isNative) {
      const listener = await Browser.addListener("browserFinished", () => {
        setIsLoading(false);
        cleanupBrowserListener();
      });
      browserFinishedListenerRef.current = listener;
    }

    const result = await loginWithDiscord(postAuthRedirect);

    if (!result.success) {
      void hapticError();
      // Browser never opened — remove the pre-registered listener.
      cleanupBrowserListener();
      toast({
        title: "Login failed",
        description: result.error || "Could not sign in with Discord",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  return (
    <div
      className="terminal-page flex min-h-screen items-center justify-center p-4"
      data-testid="login-page"
    >
      <Card variant="terminal" className="terminal-shell w-full max-w-md">
        <CardHeader className="space-y-3 border-b border-border pb-4 text-left">
          <div className="terminal-strip">Account Access</div>
          <div>
            <CardTitle className="terminal-heading text-2xl" data-testid="login-title">
              {isNative ? "Sign in to Sportfolio" : "User Terminal"}
            </CardTitle>
            <CardDescription className="terminal-subtle mt-2">
              {isNative
                ? "Trade player shares, boost game outcomes, and compete on the leaderboard."
                : "Sign in to your account or create a new one."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {/* On native: OAuth buttons are the primary CTAs, shown above email/password */}
          {isNative && (
            <div className="mb-5 space-y-3">
              <Button
                type="button"
                variant="terminal"
                className="w-full"
                onClick={handleGoogleLogin}
                disabled={isLoading}
                data-testid="button-google-login"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <SiGoogle className="h-4 w-4 mr-2" />
                    Continue with Google
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="terminalOutline"
                className="w-full"
                onClick={handleDiscordLogin}
                disabled={isLoading}
                data-testid="button-discord-login"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <SiDiscord className="mr-2 h-4 w-4" />
                    Continue with Discord
                  </>
                )}
              </Button>
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
                    or use email
                  </span>
                </div>
              </div>
            </div>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as AuthTab)}
            className="w-full"
          >
            <TabsList variant="terminal" className="grid w-full grid-cols-2">
              <TabsTrigger variant="terminal" value="login" data-testid="tab-login">
                Login
              </TabsTrigger>
              <TabsTrigger variant="terminal" value="signup" data-testid="tab-signup">
                Sign Up
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-4">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="terminal-label">
                    Email
                  </Label>
                  <Input
                    id="login-email"
                    type="email"
                    variant="terminal"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    onBlur={normalizeEmailField}
                    autoCapitalize="none"
                    autoCorrect="off"
                    required
                    data-testid="input-login-email"
                  />
                  {showEmailError && (
                    <p className="text-xs text-destructive" data-testid="text-login-email-error">
                      Enter a valid email address.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="terminal-label">
                    Password
                  </Label>
                  <Input
                    id="login-password"
                    type="password"
                    variant="terminal"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    data-testid="input-login-password"
                  />
                </div>
                <Button
                  type="submit"
                  variant="terminal"
                  className="w-full"
                  disabled={isLoading || !emailIsValid || password.length === 0}
                  data-testid="button-login-submit"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Mail className="h-4 w-4 mr-2" />
                      Sign In with Email
                    </>
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-4">
              {signupSuccessEmail ? (
                <div className="terminal-shell space-y-4 rounded-sm border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="terminal-label text-primary">Verification Sent</p>
                      <p className="terminal-value mt-1 break-all text-sm">{signupSuccessEmail}</p>
                    </div>
                  </div>
                  <p className="terminal-subtle">
                    Open your inbox and click the verification link before signing in.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="terminalOutline"
                      className="flex-1"
                      onClick={handleResendVerification}
                      disabled={isResendingVerification}
                      data-testid="button-resend-verification"
                    >
                      {isResendingVerification ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Resend Email"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="terminal"
                      className="flex-1"
                      onClick={() => setActiveTab("login")}
                      data-testid="button-back-to-signin"
                    >
                      Back to Sign In
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email" className="terminal-label">
                      Email
                    </Label>
                    <Input
                      id="signup-email"
                      type="email"
                      variant="terminal"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      onBlur={normalizeEmailField}
                      autoCapitalize="none"
                      autoCorrect="off"
                      required
                      data-testid="input-signup-email"
                    />
                    {showEmailError && (
                      <p className="text-xs text-destructive" data-testid="text-signup-email-error">
                        Enter a valid email address.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password" className="terminal-label">
                      Password
                    </Label>
                    <Input
                      id="signup-password"
                      type="password"
                      variant="terminal"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      data-testid="input-signup-password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password" className="terminal-label">
                      Confirm Password
                    </Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      variant="terminal"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      data-testid="input-confirm-password"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="terminal"
                    className="w-full"
                    disabled={isLoading || !emailIsValid}
                    data-testid="button-signup-submit"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Mail className="h-4 w-4 mr-2" />
                        Create Account
                      </>
                    )}
                  </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>

          {/* On web: OAuth buttons are shown below the email form */}
          {!isNative && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
                    Or continue with
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="terminalOutline"
                className="w-full"
                onClick={handleGoogleLogin}
                disabled={isLoading}
                data-testid="button-google-login"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <SiGoogle className="h-4 w-4 mr-2" />
                    Sign in with Google
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="terminalOutline"
                className="mt-3 w-full"
                onClick={handleDiscordLogin}
                disabled={isLoading}
                data-testid="button-discord-login"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <SiDiscord className="mr-2 h-4 w-4" />
                    Sign in with Discord
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
