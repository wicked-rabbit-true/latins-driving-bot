import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import Home from "@/pages/Home";
import ExamSession from "@/pages/ExamSession";
import ExamResult from "@/pages/ExamResult";
import AdminQuestions from "@/pages/admin/AdminQuestions";
import AdminAnalyze from "@/pages/admin/AdminAnalyze";
import AdminBulkImport from "@/pages/admin/AdminBulkImport";
import AdminRapidReview from "@/pages/admin/AdminRapidReview";
import AdminDocxImport from "@/pages/admin/AdminDocxImport";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/examen/:sessionId" component={ExamSession} />
      <Route path="/resultado/:sessionId" component={ExamResult} />
      
      <Route path="/admin" component={AdminQuestions} />
      <Route path="/admin/analizar" component={AdminAnalyze} />
      <Route path="/admin/importar" component={AdminBulkImport} />
      <Route path="/admin/revision" component={AdminRapidReview} />
      <Route path="/admin/docx" component={AdminDocxImport} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
