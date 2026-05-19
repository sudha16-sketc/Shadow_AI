import HeroModel from "../components/HeroModel";
import {
  FaGithub,
  FaLinkedin,
  FaTwitter,
  FaDownload,
  FaTimes,
} from "react-icons/fa";

import "./Hero.css";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

export default function Hero() {
  const navigate = useNavigate();

  const [showPopup, setShowPopup] = useState(false);

  return (
    <div className="heroContainer">
      <div className="navBar">
        <button
          className="ctaBtn"
          onClick={() => navigate("/login")}
        >
          GET STARTED
        </button>
      </div>

      {/* 3D Scene */}
      <HeroModel />

      {/* UI Content Layer */}
      <div className="heroContent">
        <h1 className="heroTitle">SHADOW</h1>
        <h2 className="heroTitle2">The Gatekeeper</h2>

        {/* Download Button */}
        <button
          className="downloadBtn"
          onClick={() => setShowPopup(true)}
        >
          <FaDownload />
          Download ZIP
        </button>
      </div>

      <div className="heroLowerContent">
        <p>
          Shadow-AI Auditor monitors AI tool usage in real time,
          detecting sensitive data exposure from clipboard and inputs.
          It helps organizations prevent code, API keys, and
          confidential data leaks while enabling safe, compliant AI
          adoption.
        </p>
      </div>

      <div className="heroSocials">
        <a
          href="https://github.com/sudha16-sketc"
          target="_blank"
          rel="noreferrer"
        >
          <FaGithub />
          github
        </a>

        <a
          href="https://www.linkedin.com/in/sudhakar-sutar-801354321/"
          target="_blank"
          rel="noreferrer"
        >
          <FaLinkedin />
          linkedin
        </a>

        <a
          href="https://twitter.com"
          target="_blank"
          rel="noreferrer"
        >
          <FaTwitter />
          twitter
        </a>
      </div>

      <div className="heroStats">
        <div>Active Users: 1,284</div>
        <div>Extensions Installed: 3,912</div>
      </div>

      {/* POPUP */}
      {showPopup && (
        <div className="popupOverlay">
          <div className="popupBox">
            <button
              className="closeBtn"
              onClick={() => setShowPopup(false)}
            >
              <FaTimes />
            </button>

            <h2>Install SHADOW Extension</h2>

            < img src="steps.png"></img>

            <a
              href="/downloads/shadow-ai.zip"
              download
              className="popupDownloadBtn"
            >
              Download Extension ZIP
            </a>
          </div>
        </div>
      )}
    </div>
  );
}