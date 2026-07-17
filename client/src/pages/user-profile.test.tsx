// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import type {
  PublicProfileResponse,
  PrivateProfileSentinel,
  TrophyCaseEditorResponse,
  EligibleCollectionEntry,
} from "@shared/trophy-case";

// We import the default export; we'll render it inside a test wrapper.
import UserProfile from "./user-profile";

// ── hoisted mocks (vi.mock is hoisted above all imports) ─────────────────────

const { mockAuthState, mockParams, mockToast, mockFetch, MOCK_USER_ID } = vi.hoisted(() => ({
  mockAuthState: { user: null as { id: string; username: string } | null },
  mockParams: { id: "user-abc" },
  mockToast: vi.fn(),
  mockFetch: vi.fn(),
  MOCK_USER_ID: "user-abc",
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockAuthState.user,
    isAuthenticated: !!mockAuthState.user,
    isLoading: false,
    initError: null,
    retryInit: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("wouter", async () => {
  const actual: any = await vi.importActual("wouter");
  return {
    ...actual,
    useParams: () => mockParams,
    useLocation: () => ["/user/" + MOCK_USER_ID, vi.fn()],
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual: any = await vi.importActual("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: mockFetch,
    authenticatedFetch: mockFetch,
  };
});

// Mock supabase to avoid auth initialization issues in jsdom
vi.mock("@/lib/supabase", async () => {
  const actual: any = await vi.importActual("@/lib/supabase");
  return {
    ...actual,
    getSupabase: vi.fn().mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    }),
    getAuthSession: vi.fn().mockResolvedValue(null),
  };
});

// Mock framer-motion to avoid animation warnings in tests
vi.mock("framer-motion", async () => {
  const actual: any = await vi.importActual("framer-motion");
  return {
    ...actual,
    motion: {
      div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
      h3: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
      p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
      button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

// Mock fetch at module level
globalThis.fetch = mockFetch;

// ── helpers ──────────────────────────────────────────────────────────────────

function makePublicProfile(overrides?: Partial<PublicProfileResponse>): PublicProfileResponse {
  return {
    id: MOCK_USER_ID,
    username: "testuser",
    profileImageUrl: null,
    isPremium: false,
    createdAt: "2025-01-15T00:00:00.000Z",
    profileVisibility: "public",
    isOwner: false,
    badges: [],
    featured: [],
    ...overrides,
  };
}

function makePrivateSentinel(): PrivateProfileSentinel {
  return {
    profileVisibility: "private",
    isOwner: false,
  };
}

function makeEditorResponse(
  overrides?: Partial<TrophyCaseEditorResponse>,
): TrophyCaseEditorResponse {
  return {
    profileVisibility: "public",
    badgeDefinitionIds: [],
    featuredDefinitionIds: [],
    eligibleCollections: [],
    ...overrides,
  };
}

function makeEligible(overrides?: Partial<EligibleCollectionEntry>): EligibleCollectionEntry {
  return {
    definitionId: "def-1",
    slug: "slug-1",
    sport: "MLB",
    league: "NL",
    season: "2025",
    family: "sluggers",
    title: "Test Collection",
    artKey: "tk",
    lifecycleStatus: "tracking",
    earnedAt: "2025-06-01T00:00:00.000Z",
    completionSequence: 1,
    isBadgeEligible: true,
    ...overrides,
  };
}

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── test helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a fresh QueryClient with a queryFn that delegates to our mocked
 * globalThis.fetch, and a TestWrapper that provides routing + providers.
 */
function setupTest(opts?: {
  userId?: string;
  profileResponse?: unknown;
  editorResponse?: unknown;
  fetchImpl?: typeof mockFetch;
}) {
  const userId = opts?.userId || MOCK_USER_ID;
  const fetchFn = opts?.fetchImpl || mockFetch;

  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        retryDelay: 0,
        gcTime: 0,
        // Custom queryFn: join the key and fetch
        queryFn: async ({ queryKey }) => {
          const path = (queryKey as string[]).join("/");
          const res = await fetchFn(path);
          if (!res.ok) throw new Error(`${res.status}`);
          return res.json();
        },
      },
    },
  });

  // Set up response routing. Explicit query functions use global fetch, while
  // mutation tests use the same mock through apiRequest.
  if (opts?.fetchImpl) {
    mockFetch.mockImplementation(opts.fetchImpl);
  } else {
    fetchFn.mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes(`/api/user/${userId}/profile`)) {
        if (opts?.profileResponse === "not_found") {
          return makeResponse({ error: { code: "USER_NOT_FOUND" } }, 404);
        }
        if (opts?.profileResponse instanceof Error) {
          return makeResponse({ error: { message: opts.profileResponse.message } }, 500);
        }
        if (opts?.profileResponse !== undefined) {
          return makeResponse(opts.profileResponse);
        }
      }
      if (url.includes("/api/me/trophy-case")) {
        if (opts?.editorResponse instanceof Error) {
          return makeResponse({ error: { message: opts.editorResponse.message } }, 500);
        }
        if (opts?.editorResponse !== undefined) {
          return makeResponse(opts.editorResponse);
        }
      }
      return makeResponse({});
    });
  }

  function TestWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <Router hook={() => ["/user/" + userId, vi.fn()] as any}>
          <Route path="/user/:id">{children}</Route>
        </Router>
      </QueryClientProvider>
    );
  }

  return { wrapper: TestWrapper, queryClient: qc, fetchFn };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("UserProfile", () => {
  afterEach(() => {
    mockAuthState.user = null;
    mockParams.id = MOCK_USER_ID;
    mockToast.mockClear();
    mockFetch.mockReset();
  });

  // ── loading state ─────────────────────────────────────────────────────────

  describe("loading", () => {
    it("renders a skeleton while the profile query is pending", async () => {
      // Never resolve the fetch to keep it loading
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const { wrapper } = setupTest();

      render(<UserProfile />, { wrapper });

      expect(screen.getByLabelText("Loading profile")).toBeDefined();
      expect(document.querySelector("[aria-busy='true']")).toBeDefined();

      // Clean up: reset fetch so afterEach can clear properly
      mockFetch.mockReset();
    });
  });

  // ── public profile ────────────────────────────────────────────────────────

  describe("public profile", () => {
    it("renders the header with username, avatar, and member since", async () => {
      const profile = makePublicProfile({
        username: "trader42",
        createdAt: "2025-03-10T00:00:00.000Z",
      });
      const { wrapper, fetchFn } = setupTest({ profileResponse: profile });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("@trader42")).toBeDefined();
      });
      expect(fetchFn).toHaveBeenCalledWith(`/api/user/${MOCK_USER_ID}/profile`);
      expect(screen.getByText(/Member since March 2025/)).toBeDefined();
    });

    it("shows fallback for null username", async () => {
      const profile = makePublicProfile({ username: null });
      const { wrapper } = setupTest({ profileResponse: profile });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Unnamed User")).toBeDefined();
      });
    });

    it("shows premium badge when isPremium is true", async () => {
      const profile = makePublicProfile({ isPremium: true });
      const { wrapper } = setupTest({ profileResponse: profile });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Premium")).toBeDefined();
      });
    });

    it("renders badges and featured collections in the trophy case", async () => {
      mockAuthState.user = { id: "signed-in-viewer", username: "viewer" };
      const profile = makePublicProfile({
        badges: [
          {
            definitionId: "badge-1",
            collection: {
              slug: "slug-b1",
              definitionId: "badge-1",
              sport: "MLB",
              league: "AL",
              season: "2025",
              family: "power",
              kind: "player_slots",
              title: "Home Run King",
              artKey: "hr",
              lifecycleStatus: "final",
            },
            earnedAt: "2025-07-01T00:00:00.000Z",
          },
        ],
        featured: [
          {
            definitionId: "feat-1",
            collection: {
              slug: "slug-f1",
              definitionId: "feat-1",
              sport: "MLB",
              league: "NL",
              season: "2025",
              family: "aces",
              kind: "master",
              title: "Ace Pitchers",
              artKey: "ap",
              lifecycleStatus: "tracking",
            },
            earnedAt: "2025-06-15T00:00:00.000Z",
          },
        ],
      });
      const { wrapper } = setupTest({ profileResponse: profile });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Trophy Case")).toBeDefined();
      });

      expect(screen.getByText("Home Run King")).toBeDefined();
      expect(screen.getByText("Ace Pitchers")).toBeDefined();

      // Featured links to /collections/:slug
      const link = screen.getByLabelText("Featured collection: Ace Pitchers");
      expect(link).toBeDefined();
      expect(link.getAttribute("href")).toBe("/collections/slug-f1");
    });

    it("does not expose dead-end featured collection links to signed-out visitors", async () => {
      const profile = makePublicProfile({
        featured: [
          {
            definitionId: "f1",

            collection: {
              slug: "slug-f1",
              definitionId: "f1",
              sport: "MLB",
              league: "NL",
              season: "2025",
              family: "aces",
              kind: "master",
              title: "Ace Pitchers",
              artKey: "ap",
              lifecycleStatus: "tracking",
            },
            earnedAt: "2025-06-15T00:00:00.000Z",
          },
        ],
      });
      const { wrapper } = setupTest({ profileResponse: profile });
      render(<UserProfile />, { wrapper });

      const card = await screen.findByLabelText("Featured collection: Ace Pitchers");
      expect(card.getAttribute("href")).toBeNull();
    });

    it("shows empty trophy case state when nothing is selected", async () => {
      const profile = makePublicProfile({ badges: [], featured: [] });
      const { wrapper } = setupTest({ profileResponse: profile });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Trophy Case Empty")).toBeDefined();
      });
    });
  });

  // ── private profile ───────────────────────────────────────────────────────

  describe("private profile", () => {
    it("shows private profile sentinel when visibility is private and viewer is not owner", async () => {
      const sentinel = makePrivateSentinel();
      const { wrapper } = setupTest({ profileResponse: sentinel });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Private Profile")).toBeDefined();
      });
    });
  });

  // ── 404 / not found ──────────────────────────────────────────────────────

  describe("not found", () => {
    it("shows user not found state when server returns 404", async () => {
      const { wrapper } = setupTest({ profileResponse: "not_found" });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("User Not Found")).toBeDefined();
      });
    });

    it("shows user not found when profile is null", async () => {
      const { wrapper } = setupTest({ profileResponse: null });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("User Not Found")).toBeDefined();
      });
    });
  });

  // ── error state ───────────────────────────────────────────────────────────

  describe("error", () => {
    it("shows retryable error state when fetch fails", async () => {
      const { wrapper } = setupTest({
        profileResponse: new Error("Network error"),
      });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText(/Could not load this profile/)).toBeDefined();
      });
      expect(screen.getByText("Retry")).toBeDefined();
    });
  });

  // ── owner view ────────────────────────────────────────────────────────────

  describe("owner", () => {
    beforeEach(() => {
      mockAuthState.user = { id: MOCK_USER_ID, username: "testuser" };
    });

    it("shows edit trophy case button for owner", async () => {
      const profile = makePublicProfile({ isOwner: true });
      const { wrapper } = setupTest({ profileResponse: profile });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Edit Trophy Case")).toBeDefined();
      });
    });

    it("does not show edit trophy case for non-owner", async () => {
      const profile = makePublicProfile({ isOwner: false });
      const { wrapper } = setupTest({ profileResponse: profile });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("@testuser")).toBeDefined();
      });

      expect(screen.queryByText("Edit Trophy Case")).toBeNull();
    });
  });

  it("shows a persistent private-profile notice to the owner", async () => {
    mockAuthState.user = { id: MOCK_USER_ID, username: "testuser" };
    const { wrapper } = setupTest({
      profileResponse: makePublicProfile({
        isOwner: true,
        profileVisibility: "private",
      }),
    });

    render(<UserProfile />, { wrapper });

    expect(
      await screen.findByText("Your profile is private. Only you can see this Trophy Case."),
    ).toBeDefined();
  });

  // ── editor dialog ─────────────────────────────────────────────────────────

  describe("trophy case editor", () => {
    const eligible1 = makeEligible({
      definitionId: "def-1",
      title: "Alpha Collection",
      isBadgeEligible: true,
    });
    const eligible2 = makeEligible({
      definitionId: "def-2",
      title: "Beta Collection",
      isBadgeEligible: true,
    });
    const eligible3 = makeEligible({
      definitionId: "def-3",
      title: "Gamma Collection",
      isBadgeEligible: false,
    });

    beforeEach(() => {
      mockAuthState.user = { id: MOCK_USER_ID, username: "testuser" };
    });

    it("opens editor dialog, shows eligible collections, allows adding/removing badges", async () => {
      const user = userEvent.setup();
      const profile = makePublicProfile({ isOwner: true });
      const editorData = makeEditorResponse({
        profileVisibility: "public",
        badgeDefinitionIds: [],
        featuredDefinitionIds: [],
        eligibleCollections: [eligible1, eligible2, eligible3],
      });

      const fetchImpl = vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes(`/api/user/${MOCK_USER_ID}/profile`)) {
          return makeResponse(profile);
        }
        if (url.includes("/api/me/trophy-case")) {
          return makeResponse(editorData);
        }
        return makeResponse({});
      });

      const { wrapper } = setupTest({ fetchImpl });

      render(<UserProfile />, { wrapper });

      // Wait for profile to load and show "Edit Trophy Case" button
      await waitFor(() => {
        expect(screen.getByText("Edit Trophy Case")).toBeDefined();
      });

      // Open editor
      await user.click(screen.getByText("Edit Trophy Case"));

      // Wait for editor to load
      await waitFor(() => {
        expect(screen.getByText("Profile Visibility")).toBeDefined();
      });

      // Open eligible items section
      const availableBtn = screen.getByText(/Available/);
      await user.click(availableBtn);

      await waitFor(() => {
        expect(screen.getByText("Alpha Collection")).toBeDefined();
        expect(screen.getByText("Beta Collection")).toBeDefined();
        expect(screen.getByText("Gamma Collection")).toBeDefined();
      });

      // Add Alpha as badge
      await user.click(screen.getByLabelText("Add Alpha Collection as badge"));
      await waitFor(() => {
        expect(screen.getByText("Badges (1/5)")).toBeDefined();
      });

      // A completed collection can be shown in both lists.
      await user.click(screen.getByLabelText("Add Alpha Collection as featured"));
      await waitFor(() => {
        expect(screen.getByText("Featured Collections (1/4)")).toBeDefined();
      });

      // Add Beta as badge
      await user.click(screen.getByLabelText("Add Beta Collection as badge"));
      await waitFor(() => {
        expect(screen.getByText("Badges (2/5)")).toBeDefined();
      });

      // Gamma has isBadgeEligible=false, badge button should be disabled
      const addGammaBadge = screen.getByRole("button", {
        name: "Add Gamma Collection as badge",
      });
      expect((addGammaBadge as HTMLButtonElement).disabled).toBe(true);
      // Reason text is visible and programmatically associated via aria-describedby
      const gammaReasonId = addGammaBadge.getAttribute("aria-describedby");
      expect(gammaReasonId).toBeTruthy();
      const gammaReason = document.getElementById(gammaReasonId!);
      expect(gammaReason?.textContent?.toLowerCase()).toContain("complete the current");

      // Remove Alpha
      await user.click(screen.getByLabelText("Remove Alpha Collection from badge"));
      await waitFor(() => {
        expect(screen.getByText("Badges (1/5)")).toBeDefined();
      });
    });

    it("allows reordering badges with up/down controls", async () => {
      const user = userEvent.setup();
      const profile = makePublicProfile({ isOwner: true });
      const editorData = makeEditorResponse({
        profileVisibility: "public",
        badgeDefinitionIds: ["def-1", "def-2"],
        featuredDefinitionIds: [],
        eligibleCollections: [eligible1, eligible2],
      });

      const fetchImpl = vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes(`/api/user/${MOCK_USER_ID}/profile`)) {
          return makeResponse(profile);
        }
        if (url.includes("/api/me/trophy-case")) {
          return makeResponse(editorData);
        }
        return makeResponse({});
      });

      const { wrapper } = setupTest({ fetchImpl });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Edit Trophy Case")).toBeDefined();
      });
      await user.click(screen.getByText("Edit Trophy Case"));

      await waitFor(() => {
        expect(screen.getByText("Badges (2/5)")).toBeDefined();
      });

      // Alpha should be first (up disabled), Beta last (down disabled)
      const moveUpAlpha = screen.getByLabelText("Move Alpha Collection up in badge");
      expect((moveUpAlpha as HTMLButtonElement).disabled).toBe(true);

      const moveDownBeta = screen.getByLabelText("Move Beta Collection down in badge");
      expect((moveDownBeta as HTMLButtonElement).disabled).toBe(true);

      // Move Alpha down
      await user.click(screen.getByLabelText("Move Alpha Collection down in badge"));

      // After move, Alpha is now second
      await waitFor(() => {
        const newMoveDown = screen.getByLabelText("Move Alpha Collection down in badge");
        expect((newMoveDown as HTMLButtonElement).disabled).toBe(true);
      });
    });

    it("saves the trophy case and shows success toast", async () => {
      const user = userEvent.setup();
      const profile = makePublicProfile({ isOwner: true });
      const eligible = makeEligible({
        definitionId: "def-save",
        title: "Save Me",
        isBadgeEligible: true,
      });
      const editorData = makeEditorResponse({
        badgeDefinitionIds: [],
        featuredDefinitionIds: [],
        eligibleCollections: [eligible],
      });

      const fetchImpl = vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes(`/api/user/${MOCK_USER_ID}/profile`)) {
          return makeResponse(profile);
        }
        if (url.includes("/api/me/trophy-case")) {
          return makeResponse(editorData);
        }
        return makeResponse({});
      });

      const { wrapper } = setupTest({ fetchImpl });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Edit Trophy Case")).toBeDefined();
      });
      await user.click(screen.getByText("Edit Trophy Case"));

      await waitFor(() => {
        expect(screen.getByText("Save")).toBeDefined();
      });

      // Open eligible
      await user.click(screen.getByText(/Available/));
      await waitFor(() => {
        expect(screen.getByText("Save Me")).toBeDefined();
      });

      // Add as badge
      await user.click(screen.getByLabelText("Add Save Me as badge"));

      // Click save
      mockFetch.mockResolvedValueOnce(
        makeResponse({ ...editorData, badgeDefinitionIds: ["def-save"] }),
      );
      await user.click(screen.getByText("Save"));

      await waitFor(() => {
        // apiRequest was called with PUT
        expect(mockFetch).toHaveBeenCalledWith(
          "PUT",
          "/api/me/trophy-case",
          expect.objectContaining({
            badgeDefinitionIds: ["def-save"],
            profileVisibility: "public",
          }),
        );
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Trophy case saved",
            description: "Your Trophy Case is live on your public profile.",
          }),
        );
      });
    });

    it("confirms that a private trophy case remains private after save", async () => {
      const user = userEvent.setup();
      const editorData = makeEditorResponse({ profileVisibility: "public" });
      const fetchImpl = vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes(`/api/user/${MOCK_USER_ID}/profile`)) {
          return makeResponse(makePublicProfile({ isOwner: true }));
        }
        if (url.includes("/api/me/trophy-case")) return makeResponse(editorData);
        return makeResponse({});
      });
      const { wrapper } = setupTest({ fetchImpl });

      render(<UserProfile />, { wrapper });
      await user.click(await screen.findByText("Edit Trophy Case"));
      await user.click(await screen.findByRole("switch", { name: "Public profile visibility" }));
      mockFetch.mockResolvedValueOnce(
        makeResponse({ ...editorData, profileVisibility: "private" }),
      );
      await user.click(screen.getByText("Save"));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Trophy case saved",
            description: "Your Trophy Case is saved and remains private.",
          }),
        );
      });
    });

    it("keeps the editor open with the draft intact when save fails", async () => {
      const user = userEvent.setup();
      const eligible = makeEligible({ definitionId: "def-save", title: "Save Me" });
      const editorData = makeEditorResponse({ eligibleCollections: [eligible] });
      const fetchImpl = vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes(`/api/user/${MOCK_USER_ID}/profile`)) {
          return makeResponse(makePublicProfile({ isOwner: true }));
        }
        if (url.includes("/api/me/trophy-case")) return makeResponse(editorData);
        return makeResponse({});
      });
      const { wrapper } = setupTest({ fetchImpl });

      render(<UserProfile />, { wrapper });
      await user.click(await screen.findByText("Edit Trophy Case"));
      await user.click(await screen.findByText(/Available/));
      await user.click(screen.getByLabelText("Add Save Me as badge"));
      mockFetch.mockRejectedValueOnce(new Error("Write failed"));
      await user.click(screen.getByText("Save"));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Save failed", variant: "destructive" }),
        );
      });
      expect(screen.getByLabelText("Remove Save Me from badge")).toBeDefined();
      expect(screen.getByRole("dialog")).toBeDefined();
    });

    it("shows error in editor when editor fetch fails", async () => {
      const user = userEvent.setup();
      const profile = makePublicProfile({ isOwner: true });

      const fetchImpl = vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes(`/api/user/${MOCK_USER_ID}/profile`)) {
          return makeResponse(profile);
        }
        if (url.includes("/api/me/trophy-case")) {
          return makeResponse({ error: { message: "DB down" } }, 500);
        }
        return makeResponse({});
      });

      const { wrapper } = setupTest({ fetchImpl });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Edit Trophy Case")).toBeDefined();
      });
      await user.click(screen.getByText("Edit Trophy Case"));

      await waitFor(() => {
        expect(screen.getByText(/Could not load trophy case editor/)).toBeDefined();
        expect(screen.getByRole("alert").textContent).toContain(
          "Could not load trophy case editor.",
        );
      });
    });

    it("enforces the 5-badge and 4-featured limits", async () => {
      const user = userEvent.setup();
      const profile = makePublicProfile({ isOwner: true });

      const eligibles = [1, 2, 3, 4, 5, 6].map((i) =>
        makeEligible({
          definitionId: `def-${i}`,
          title: `Collection ${i}`,
          isBadgeEligible: true,
        }),
      );

      const editorData = makeEditorResponse({
        badgeDefinitionIds: eligibles.slice(0, 5).map((e) => e.definitionId),
        featuredDefinitionIds: eligibles.slice(0, 4).map((e) => e.definitionId),
        eligibleCollections: eligibles,
      });

      const fetchImpl = vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes(`/api/user/${MOCK_USER_ID}/profile`)) {
          return makeResponse(profile);
        }
        if (url.includes("/api/me/trophy-case")) {
          return makeResponse(editorData);
        }
        return makeResponse({});
      });

      const { wrapper } = setupTest({ fetchImpl });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Edit Trophy Case")).toBeDefined();
      });
      await user.click(screen.getByText("Edit Trophy Case"));

      await waitFor(() => {
        expect(screen.getByText("Badges (5/5)")).toBeDefined();
        expect(screen.getByText("Featured Collections (4/4)")).toBeDefined();
      });

      // Open available section
      await user.click(screen.getByText(/Available/));
      await waitFor(() => {
        expect(screen.getByText("Collection 6")).toBeDefined();
      });

      // Both controls are disabled once their respective list reaches its limit.
      const addBtn = screen.getByRole("button", {
        name: "Add Collection 6 as badge",
      });
      expect((addBtn as HTMLButtonElement).disabled).toBe(true);
      // Visible reason text is programmatically associated via aria-describedby
      const badgeReasonId = addBtn.getAttribute("aria-describedby");
      expect(badgeReasonId).toBeTruthy();
      const reasonEl = document.getElementById(badgeReasonId!);
      expect(reasonEl).toBeDefined();
      expect(reasonEl?.textContent?.toLowerCase()).toContain("badge limit reached");
      const featureBtn = screen.getByLabelText("Add Collection 5 as featured");
      expect((featureBtn as HTMLButtonElement).disabled).toBe(true);
      const featuredReasonId = featureBtn.getAttribute("aria-describedby");
      expect(featuredReasonId).toBeTruthy();
    });

    it("discards unsaved edits when cancelled and reopened", async () => {
      const user = userEvent.setup();
      const editorData = makeEditorResponse({
        badgeDefinitionIds: ["def-1", "def-2"],
        eligibleCollections: [eligible1, eligible2],
      });
      const fetchImpl = vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes(`/api/user/${MOCK_USER_ID}/profile`)) {
          return makeResponse(makePublicProfile({ isOwner: true }));
        }
        if (url.includes("/api/me/trophy-case")) return makeResponse(editorData);
        return makeResponse({});
      });
      const { wrapper } = setupTest({ fetchImpl });

      render(<UserProfile />, { wrapper });
      await user.click(await screen.findByText("Edit Trophy Case"));
      await user.click(await screen.findByLabelText("Move Beta Collection up in badge"));
      expect(
        (screen.getByLabelText("Move Beta Collection up in badge") as HTMLButtonElement).disabled,
      ).toBe(true);

      await user.click(screen.getByText("Cancel"));
      await user.click(screen.getByText("Edit Trophy Case"));

      expect(
        (await screen.findByLabelText("Move Alpha Collection up in badge")) as HTMLButtonElement,
      ).toMatchObject({ disabled: true });
      expect(
        (screen.getByLabelText("Move Beta Collection up in badge") as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it("allows toggling profile visibility", async () => {
      const user = userEvent.setup();
      const profile = makePublicProfile({ isOwner: true });
      const editorData = makeEditorResponse({
        profileVisibility: "public",
        badgeDefinitionIds: [],
        featuredDefinitionIds: [],
        eligibleCollections: [],
      });

      const fetchImpl = vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes(`/api/user/${MOCK_USER_ID}/profile`)) {
          return makeResponse(profile);
        }
        if (url.includes("/api/me/trophy-case")) {
          return makeResponse(editorData);
        }
        return makeResponse({});
      });

      const { wrapper } = setupTest({ fetchImpl });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("Edit Trophy Case")).toBeDefined();
      });
      await user.click(screen.getByText("Edit Trophy Case"));

      await waitFor(() => {
        expect(screen.getByText("Profile Visibility")).toBeDefined();
      });

      // Currently public
      const toggleBtn = screen.getByRole("switch", {
        name: "Public profile visibility",
      });
      expect(toggleBtn.getAttribute("aria-checked")).toBe("true");

      await user.click(toggleBtn);

      await waitFor(() => {
        expect(screen.getByText("Private")).toBeDefined();
      });
    });

    it("renders Settings link for owner navigation to account settings", async () => {
      const profile = makePublicProfile({ isOwner: true });
      const { wrapper } = setupTest({ profileResponse: profile });

      render(<UserProfile />, { wrapper });

      await waitFor(() => {
        expect(screen.getByLabelText("Account Settings")).toBeDefined();
      });

      const settingsLink = screen.getByLabelText("Account Settings").closest("a");
      expect(settingsLink).toBeDefined();
      expect(settingsLink?.getAttribute("href")).toBe("/settings");
    });
  });
});
