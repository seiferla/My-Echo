import { createBrowserRouter } from "react-router";
import { ChatInterface } from "./components/ChatInterface";
import { PhrasesPage } from "./components/PhrasesPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <ChatInterface />,
  },
  {
    path: "/phrases",
    element: <PhrasesPage />,
  },
]);
