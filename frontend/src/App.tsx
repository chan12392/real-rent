import { ExplorePage } from "./features/explore/ExplorePage";
import { ComparisonPage } from "./features/comparison/ComparisonPage";
import "./App.css";

export default function App() {
  if (new URLSearchParams(window.location.search).get("view") === "legacy")
    return (
      <main className="shell">
        <h1>기존 비교 화면</h1>
        <ComparisonPage />
      </main>
    );
  return <ExplorePage />;
}
