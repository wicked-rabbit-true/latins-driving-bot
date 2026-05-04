import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "@/components/Layout";
import StudentsPage from "@/pages/students";
import StudentDetailPage from "@/pages/students/[id]";
import NewStudentPage from "@/pages/students/new";
import EditStudentPage from "@/pages/students/edit";
import QuestionsPage from "@/pages/questions";
import PendientesPage from "@/pages/pendientes";
import ProspectsPage from "@/pages/prospects";
import BotSettingsPage from "@/pages/bot-settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    }
  }
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/students" />} />
      <Route path="/students" component={StudentsPage} />
      <Route path="/students/new" component={NewStudentPage} />
      <Route path="/students/:id" component={StudentDetailPage} />
      <Route path="/students/:id/edit" component={EditStudentPage} />
      <Route path="/questions" component={QuestionsPage} />
      <Route path="/pendientes" component={PendientesPage} />
      <Route path="/prospects" component={ProspectsPage} />
      <Route path="/bot-settings" component={BotSettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
