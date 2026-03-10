import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Home, LandingPage } from "../pages";

export const Routers = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/landing" element={<LandingPage />} />
      </Routes>
    </Router>
  );
};
