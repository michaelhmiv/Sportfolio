import { useMemo, useState } from "react";
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
import { SiGoogle } from "react-icons/si";

type AuthTab = "login" | "signup";

export default function Login() {
  const [, navigate] = useLocation();
  const {
    login,
    signup,
    resendVerification,
    loginWithGoogle,
    isAuthenticated,
    isLoading: authLoading,
  } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<AuthTab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [signupSuccessEmail, setSignupSuccessEmail] = useState<string | null>(null);

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
    navigate("/");
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
      navigate("/");
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
    setIsLoading(true);
    const result = await loginWithGoogle();

    if (!result.success) {
      toast({
        title: "Login failed",
        description: result.error || "Could not sign in with Google",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4" data-testid="login-page">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl" data-testid="login-title">
            Welcome
          </CardTitle>
          <CardDescription>Sign in to your account or create a new one</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as AuthTab)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" data-testid="tab-login">
                Login
              </TabsTrigger>
              <TabsTrigger value="signup" data-testid="tab-signup">
                Sign Up
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
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
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    data-testid="input-login-password"
                  />
                </div>
                <Button
                  type="submit"
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

            <TabsContent value="signup">
              {signupSuccessEmail ? (
                <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">Verification email sent</p>
                      <p className="text-sm text-muted-foreground break-all">
                        {signupSuccessEmail}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Open your inbox and click the verification link before signing in.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
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
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
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
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      data-testid="input-signup-password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm Password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      data-testid="input-confirm-password"
                    />
                  </div>
                  <Button
                    type="submit"
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

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
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
        </CardContent>
      </Card>
    </div>
  );
}
