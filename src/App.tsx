import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import OAuthConsent from "@/pages/OAuthConsent";
import Dashboard from "@/pages/Dashboard";
import Contracts from "@/pages/Contracts";
import OpenBids from "@/pages/OpenBids";
import BidDetail from "@/pages/BidDetail";
import BidPipeline from "@/pages/BidPipeline";
import ContractsExpiring from "@/pages/ContractsExpiring";
import Analytics from "@/pages/Analytics";
import Buyers from "@/pages/Buyers";
import Suppliers from "@/pages/Suppliers";
import SavedSearches from "@/pages/SavedSearches";
import Conferences from "@/pages/Conferences";
import Speakers from "@/pages/Speakers";
import SpeakerProfile from "@/pages/SpeakerProfile";
import Frameworks from "@/pages/Frameworks";
import ContractsFinderSearch from "@/pages/ContractsFinderSearch";
import ContractsFinderBuyers from "@/pages/ContractsFinderBuyers";
import Admin from "@/pages/Admin";
import Settings from "@/pages/Settings";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/contracts" element={<Contracts />} />
                      <Route path="/open-bids" element={<OpenBids />} />
                      <Route path="/open-bids/:id" element={<BidDetail />} />
                      <Route path="/pipeline" element={<BidPipeline />} />
                      <Route path="/expiring" element={<ContractsExpiring />} />
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/buyers" element={<Buyers />} />
                      <Route path="/suppliers" element={<Suppliers />} />
                      <Route path="/saved-searches" element={<SavedSearches />} />
                      <Route path="/conferences" element={<Conferences />} />
                      <Route path="/speakers" element={<Speakers />} />
                      <Route path="/speakers/:slug" element={<SpeakerProfile />} />
                      <Route path="/frameworks" element={<Frameworks />} />
                      <Route path="/contracts-finder" element={<ContractsFinderSearch />} />
                      <Route path="/contracts-finder-buyers" element={<ContractsFinderBuyers />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route
                        path="/admin"
                        element={
                          <ProtectedRoute adminOnly>
                            <Admin />
                          </ProtectedRoute>
                        }
                      />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
