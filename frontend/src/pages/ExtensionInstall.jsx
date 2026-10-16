import React from 'react';
import { Link } from 'react-router-dom';
import { FaShieldAlt, FaDownload, FaChrome, FaArrowLeft, FaExternalLinkAlt, FaCheckCircle, FaFileCode, FaPlug } from 'react-icons/fa';
import Footer from '../components/Footer';

export default function ExtensionInstall() {
  return (
    <div className="min-h-screen bg-[#0d0d0d] text-[#f2f2f2]">
      {/* Header */}
      <header className="sticky top-0 z-50 h-16 flex items-center justify-between px-6 bg-black/70 backdrop-blur border-b border-white/10">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
            <FaShieldAlt />
          </div>
          <div>
            <div className="text-sm font-bold tracking-wider">SHADOW AI</div>
            <div className="text-[9px] text-red-400 tracking-[0.3em]">EXTENSION</div>
          </div>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/docs" className="text-gray-400 hover:text-white transition-colors">Docs</Link>
          <Link to="/" className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5">
            <FaArrowLeft className="text-xs" /> Back to Home
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-12">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono tracking-widest mb-6">
            <FaShieldAlt className="text-xs" /> INSTALL EXTENSION
          </div>
          <h1 className="text-4xl md:text-6xl font-black mb-4 tracking-tight">
            Shadow AI Browser Extension
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Detect sensitive data in real-time before sending to AI tools. Install the Chrome extension to protect your prompts.
          </p>
        </div>
      </section>

      {/* Installation Steps */}
      <section className="max-w-5xl mx-auto px-6 pb-12">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Step 1 */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 hover:border-red-500/40 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 font-bold">
                1
              </div>
              <h2 className="text-xl font-bold">Get the Source</h2>
            </div>
            <p className="text-gray-400 mb-4">
              Clone the repository (or download it as a ZIP) — the extension lives in the <code className="bg-black/60 px-1.5 py-0.5 rounded">shadow-extension/</code> directory.
            </p>
            <a
              href="https://github.com/sudha16-sketc/Shadow_AI"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-semibold transition-colors"
            >
              <FaDownload /> Get from GitHub <FaExternalLinkAlt className="text-xs" />
            </a>
          </div>

          {/* Step 2 */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 hover:border-red-500/40 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 font-bold">
                2
              </div>
              <h2 className="text-xl font-bold">Build Locally</h2>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-lg p-4 mb-4 font-mono text-sm overflow-x-auto">
              <div className="text-gray-500"># From the repo root</div>
              <div>cd shadow-extension</div>
              <div>npm ci</div>
              <div className="text-gray-500"># configure your API URL</div>
              <div>cp .env.development.example .env.development</div>
              <div>npm run build:development</div>
            </div>
            <p className="text-gray-400 text-sm">This creates the <code className="bg-black/60 px-1.5 py-0.5 rounded">dist/</code> directory</p>
          </div>

          {/* Step 3 */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 hover:border-red-500/40 transition-colors md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 font-bold">
                3
              </div>
              <h2 className="text-xl font-bold">Load in Chrome</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="flex gap-3">
                <FaChrome className="text-2xl text-red-400 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold mb-1">Open Extensions Page</h3>
                  <p className="text-gray-400 text-sm">Go to <code className="bg-black/60 px-1.5 py-0.5 rounded">chrome://extensions</code></p>
                </div>
              </div>
              <div className="flex gap-3">
                <FaPlug className="text-2xl text-red-400 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold mb-1">Enable Developer Mode</h3>
                  <p className="text-gray-400 text-sm">Toggle "Developer mode" in the top right</p>
                </div>
              </div>
              <div className="flex gap-3">
                <FaFileCode className="text-2xl text-red-400 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold mb-1">Load Unpacked</h3>
                  <p className="text-gray-400 text-sm">Click "Load unpacked" and select the <code className="bg-black/60 px-1.5 py-0.5 rounded">dist/</code> folder</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-12">
        <h2 className="text-2xl font-bold mb-6">What it does</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <FaCheckCircle className="text-red-400 text-xl mb-2" />
            <h3 className="font-semibold mb-1">Real-time Detection</h3>
            <p className="text-gray-400 text-sm">Scans prompts for sensitive data patterns as you type</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <FaCheckCircle className="text-red-400 text-xl mb-2" />
            <h3 className="font-semibold mb-1">Policy Enforcement</h3>
            <p className="text-gray-400 text-sm">Blocks or sanitizes sensitive content before sending</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <FaCheckCircle className="text-red-400 text-xl mb-2" />
            <h3 className="font-semibold mb-1">Complete Audit Trail</h3>
            <p className="text-gray-400 text-sm">All events logged for compliance and review</p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
