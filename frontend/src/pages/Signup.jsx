import React, { useState } from "react";
import "./Signup.css";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../hooks/useAuth";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const Signup = ({ initialLogin = false }) => {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [isLogin, setIsLogin] = useState(initialLogin);

  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  const handleSignup = async (e) => {
    e.preventDefault();

    if (!username || !email || !password) {
      alert("Please fill in all fields!");
      return;
    }

    try {
      const response = await fetch(`${API}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();
      if (response.ok) {
        setStatus("Signup successful! Redirecting to dashboard...");
        // Automatically log the user in after signup
        try {
          await login(email, password);
          navigate("/overview");
        } catch (loginErr) {
          console.error("Auto-login failed:", loginErr);
          setStatus("Signup successful! Please log in manually.");
          setIsLogin(true);
        }
      } else {
        setStatus(data.message || data.error || "Signup failed");
        alert(data.error || data.message || "Signup failed");
      }
    } catch (err) {
      console.error(err);
      setStatus("Server error. Try again later.");
      alert("Server error. Try again later.");
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      alert("Please fill in all fields!");
      return;
    }

    try {
      await login(email, password);
      setStatus("Login successful!");
      navigate("/overview");
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Login failed");
      alert(err.message || "Login failed");
    }
  };

  const handleSignout = () => {
    logout();
    navigate("/hero");
  };

  return (
    <div className="signup-container Signup relative">
      <div className="left-container">
        <h1 className="h12">SHADOW</h1>

        <div className="toggle-buttons align-center ">
          <button
            type="button"
            className={!isLogin ? "active-btn" : ""}
            onClick={() => setIsLogin(false)}
          >
            Sign Up
          </button>
          <button
            type="button"
            className={isLogin ? "active-btn" : ""}
            onClick={() => setIsLogin(true)}
          >
            Login
          </button>
        </div>

        {status && <div className="status-message">{status}</div>}

        {!isLogin ? (
          <form className="form" onSubmit={handleSignup}>
            <input
              type="text"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="submit">SIGN UP</button>
          </form>
        ) : (
          <form className="form" onSubmit={handleLogin}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="submit">LOGIN</button>
          </form>
        )}

        <div className="alt-buttons">
          OR
          {token && (
            <button
              className="connectbtn rounded bg-red-500 font-bold text-white hover:bg-red-600"
              onClick={handleSignout}
              type="button"
            >
              SIGN OUT
            </button>
          )}
          <p style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>
            Platform administrator?{" "}
            <a href="/platform/login" style={{ textDecoration: "underline" }}>
              Use the platform console
            </a>
          </p>
        </div>
      </div>

      <div className="right-container">
        <div className="triangle"></div>
      </div>

      <button
        className="apperbtn1 absolute bottom-10 left-10 px-3 py-1 rounded bg-yellow-400 font-bold text-black"
        onClick={() => window.history.back()}
        type="button"
      >
        ⬅ BACK
      </button>
    </div>
  );
};

export default Signup;
