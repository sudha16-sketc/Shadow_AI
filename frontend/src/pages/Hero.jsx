import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FaShieldAlt,
  FaExternalLinkAlt,
} from "react-icons/fa";

import ScrollImageSequence from "../components/ScrollImageSequence";
import "./Hero.css";

export default function Hero() {
  const navigate = useNavigate();
  const [, setShowPopup] = useState(false);

  return (
    <div className="heroPageWrapper">
      {/* Top Fixed Navigation Bar */}
      <header className="heroNav">
        <a href="#top" className="heroNavBrand">
          <div className="heroNavLogoIcon">
            <FaShieldAlt />
          </div>
          <div>
            <div className="heroNavBrandText">SHADOW AI</div>
            <div className="heroNavBrandSub">THE GATEKEEPER</div>
          </div>
        </a>

        <nav className="heroNavLinks">
          <Link to="/docs" className="heroNavLink">DOCS</Link>
          <a href="#extension" className="heroNavLink">EXTENSION</a>
          <a
            href="https://github.com/sudha16-sketc/Shadow_AI"
            target="_blank"
            rel="noreferrer"
            className="heroNavLink flex items-center gap-1.5"
          >
            GITHUB <FaExternalLinkAlt className="text-[10px]" />
          </a>
        </nav>

        <div className="heroNavActions">
          <button
            type="button"
            className="heroNavLoginBtn"
            onClick={() => navigate("/login")}
          >
            SIGN IN
          </button>
          <button
            type="button"
            className="ctaBtn"
            onClick={() => navigate("/signup")}
          >
            GET STARTED
          </button>
        </div>
      </header>

      {/* Anchor for top of page */}
      <div id="interception" />

      {/* 
        Scroll-driven HTML Canvas Image Sequence
        Pinned during scroll playback (192 frames) via GSAP ScrollTrigger
      */}
      <ScrollImageSequence
        onOpenDownloadModal={() => setShowPopup(true)}
        onGetStarted={() => navigate("/signup")}
      />
    </div>
  );
}