import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Home, LandingPage } from "../pages";

export const Routers = () => {
  return (
    <Router>
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </Router>
  );
};
