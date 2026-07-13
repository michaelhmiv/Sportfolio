import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { APP_NAV_ITEMS, isAppRouteActive, type AppNavItem } from "@/lib/app-navigation";
import { useNewsNotifications } from "@/lib/news-notification-context";
import { useNotifications } from "@/lib/notification-context";
import { preloadRoute } from "@/lib/route-preload";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";

export function AppSidebar() {
  const [location] = useLocation();
  const { isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const { unreadCount } = useNotifications();
  const { unreadNewsCount, hasUnreadDigest } = useNewsNotifications();
  const isPremium = user?.isPremium || false;

  const handleNavigation = (item: AppNavItem, event: React.MouseEvent) => {
    if (item.requiresAuth && !isAuthenticated) {
      event.preventDefault();
      toast({
        title: "Authentication Required",
        description:
          item.id === "premium"
            ? "Please create an account or log in to access Premium features."
            : "Please create an account or log in to view your portfolio.",
        variant: "destructive",
      });
    }
  };

  return (
    <Sidebar
      className={cn("border-r border-sidebar-border", isPremium && "border-r-premium/30")}
      data-testid="app-sidebar"
    >
      <SidebarContent className="p-3">
        <SidebarGroup>
          <SidebarGroupLabel className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-content-muted">
            Exchange
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {APP_NAV_ITEMS.map((item) => {
                const isActive = isAppRouteActive(location, item.href);
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        data-testid={`link-${item.id}`}
                        onClick={(event) => handleNavigation(item, event)}
                        onFocus={() => preloadRoute(item.href)}
                        onMouseEnter={() => preloadRoute(item.href)}
                        className={cn(
                          "relative min-h-10 rounded-control font-medium text-content-muted transition-colors duration-fast hover:bg-action-hover hover:text-content",
                          isActive &&
                            "bg-brand-subtle text-content before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-pill before:bg-brand",
                          item.tone === "premium" && "text-premium",
                          item.tone === "boost" && "text-boost",
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                        <span>{item.label}</span>

                        {item.id === "portfolio" && unreadCount > 0 ? (
                          <Badge
                            variant="count"
                            className="ml-auto"
                            aria-label={`${unreadCount} unread portfolio notifications`}
                            data-testid="badge-notification-count"
                          >
                            {unreadCount}
                          </Badge>
                        ) : null}

                        {item.id === "news" && (unreadNewsCount > 0 || hasUnreadDigest) ? (
                          <span className="ml-auto flex items-center gap-1.5">
                            {hasUnreadDigest ? (
                              <span
                                className="h-2 w-2 rounded-circle bg-status-live"
                                aria-label="Unread news digest"
                                data-testid="dot-digest-unread"
                              />
                            ) : null}
                            {unreadNewsCount > 0 ? (
                              <Badge
                                variant="info"
                                aria-label={`${unreadNewsCount} unread news items`}
                                data-testid="badge-news-count"
                              >
                                {unreadNewsCount}
                              </Badge>
                            ) : null}
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
