import HeroModel from "../components/HeroModel";
import { FaGithub, FaLinkedin, FaTwitter } from "react-icons/fa";
import "./Hero.css";
import LoginPage from './Login';
import { useNavigate } from "react-router-dom";


export default function Hero() {
  const navigate = useNavigate();
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
      </div>

      <div className="heroLowerContent">
        <p>
          Shadow-AI Auditor monitors AI tool usage in real time, detecting
          sensitive data exposure from clipboard and inputs. It helps
          organizations prevent code, API keys, and confidential data leaks
          while enabling safe, compliant AI adoption.
        </p>
      </div>

      <div className="heroSocials">
        <a href="https://github.com/sudha16-sketc" target="_blank">
          <FaGithub />
          github
        </a>

        <a href="https://www.linkedin.com/in/sudhakar-sutar-801354321/" target="_blank">
          <FaLinkedin />
          linkedin
        </a>

        <a href="https://twitter.com" target="_blank">
          <FaTwitter />
          twitter
        </a>
      </div>
      <div className="heroStats">
  <div>Active Users: 1,284</div>
  <div>Extensions Installed: 3,912</div>
</div>
    </div>
  );
}
