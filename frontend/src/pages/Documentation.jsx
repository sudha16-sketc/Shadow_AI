import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FaShieldAlt,
  FaSearch,
  FaTimes,
  FaBars,
  FaGithub,
  FaArrowLeft,
} from 'react-icons/fa';
import { docsSections } from '../docs/docsSections';
import './Documentation.css';

export default function Documentation() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(docsSections[0]?.id ?? '');
  const [menuOpen, setMenuOpen] = useState(false);

  const q = query.trim().toLowerCase();

  const visibleSections = useMemo(() => {
    if (!q) return docsSections;
    return docsSections.filter(
      section =>
        section.title.toLowerCase().includes(q) ||
        section.keywords.some(keyword => keyword.includes(q)),
    );
  }, [q]);

  // Scroll spy: mark the section currently at the top of the viewport.
  useEffect(() => {
    const ids = docsSections.map(section => section.id);
    let frame = 0;

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const probe = window.scrollY + 130;
        let current = ids[0];
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el && el.offsetTop <= probe) current = id;
        }
        setActiveId(current);
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  function goTo(id) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    }
    setMenuOpen(false);
  }

  return (
    <div className="docsRoot">
      <header className="docsTopbar">
        <Link to="/hero" className="docsBrand" aria-label="Back to Shadow AI home">
          <span className="docsBrandIcon">
            <FaShieldAlt />
          </span>
          <span className="docsBrandText">
            <span className="docsBrandName">SHADOW AI</span>
            <span className="docsBrandSub">DOCUMENTATION</span>
          </span>
        </Link>

        <div className="docsTopbarActions">
          <a
            className="docsTopbarLink"
            href="https://github.com/sudha16-sketc/Shadow_AI"
            target="_blank"
            rel="noreferrer"
          >
            <FaGithub /> <span className="docsHideSm">GitHub</span>
          </a>
          <Link className="docsTopbarBtn" to="/login">
            Sign in
          </Link>
          <button
            type="button"
            className="docsMenuBtn"
            aria-label="Toggle documentation navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
          >
            {menuOpen ? <FaTimes /> : <FaBars />}
          </button>
        </div>
      </header>

      <div className={`docsShell ${menuOpen ? 'docsShellOpen' : ''}`}>
        <div className="docsOverlay" onClick={() => setMenuOpen(false)} aria-hidden="true" />

        <aside className="docsSidebar" aria-label="Documentation sections">
          <div className="docsSearchWrap">
            <FaSearch className="docsSearchIcon" aria-hidden="true" />
            <input
              type="search"
              className="docsSearch"
              placeholder="Search documentation…"
              value={query}
              onChange={event => setQuery(event.target.value)}
              aria-label="Search documentation"
            />
            {query ? (
              <button
                type="button"
                className="docsSearchClear"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <FaTimes />
              </button>
            ) : null}
          </div>

          <p className="docsNavMeta">
            {q
              ? `${visibleSections.length} of ${docsSections.length} sections`
              : `${docsSections.length} sections`}
          </p>

          <nav className="docsNav">
            {visibleSections.map(section => (
              <button
                key={section.id}
                type="button"
                className={`docsNavLink ${activeId === section.id ? 'isActive' : ''}`}
                onClick={() => goTo(section.id)}
              >
                {section.title}
              </button>
            ))}
            {visibleSections.length === 0 ? (
              <p className="docsNavEmpty">No sections match “{query}”.</p>
            ) : null}
          </nav>

          <Link to="/hero" className="docsSidebarBack">
            <FaArrowLeft /> Back to site
          </Link>
        </aside>

        <main className="docsContent">
          <div className="docsIntro">
            <span className="docsEyebrow">PRODUCT DOCUMENTATION</span>
            <h1>Shadow AI Auditor</h1>
            <p>
              Tenant-scoped detection, audit, and policy enforcement for sensitive data sent to
              public AI tools. This documentation is derived from the repository source and is
              updated alongside the code.
            </p>
            <div className="docsIntroTags">
              <span>Detection</span>
              <span>Policy enforcement</span>
              <span>Audit</span>
              <span>Multi-tenant</span>
            </div>
          </div>

          {visibleSections.map(section => (
            <section key={section.id} id={section.id} className="docsSection">
              <h2 className="docsH2">{section.title}</h2>
              <div className="docsBody">{section.content}</div>
            </section>
          ))}

          {visibleSections.length === 0 ? (
            <div className="docsEmptyState">
              <p>No documentation sections match “{query}”.</p>
              <button type="button" className="docsClearBtn" onClick={() => setQuery('')}>
                Clear search
              </button>
            </div>
          ) : null}

          <footer className="docsFooter">
            <p>
              Derived from the Shadow AI Auditor source tree. Planned or unverified functionality is
              labelled as such; no test counts or secrets are asserted here.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
