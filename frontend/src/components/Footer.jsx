import { Link } from 'react-router-dom';
import { FaShieldAlt, FaExternalLinkAlt } from 'react-icons/fa';

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black/40">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-2 text-[#f2f2f2]">
            <FaShieldAlt className="text-red-400 text-xl" />
            <div>
              <div className="font-bold tracking-wide">SHADOW AI</div>
              <div className="text-[10px] text-red-400 tracking-[0.3em]">THE GATEKEEPER</div>
            </div>
          </Link>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-400">
            <Link to="/docs" className="hover:text-white transition-colors">Documentation</Link>
            <Link to="/extension" className="hover:text-white transition-colors">Extension</Link>
            <Link to="/login" className="hover:text-white transition-colors">Sign In</Link>
            <a
              href="https://github.com/sudha16-sketc/Shadow_AI"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors inline-flex items-center gap-1.5"
            >
              GitHub <FaExternalLinkAlt className="text-[10px]" />
            </a>
          </nav>
        </div>

        <div className="text-center text-xs text-gray-500 mt-8">
          © {new Date().getFullYear()} Shadow AI Auditor. Proof of concept for cybersecurity research.
        </div>
      </div>
    </footer>
  );
}
