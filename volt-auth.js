
/* VOLT — Appwrite authentication connector */
(function () {
  let client = null;
  let account = null;
  const listeners = new Set();
  let lastUserId = null;

  const config = window.VOLT_APPWRITE_CONFIG || {};

  const configured = () => !!(
    config.endpoint &&
    config.projectId &&
    !config.projectId.includes("YOUR_")
  );

  function ready() {
    if (!configured()) {
      throw new Error("VOLT online accounts are not configured yet.");
    }

    if (!window.Appwrite) {
      throw new Error("Appwrite SDK could not load. Check your internet connection and reload VOLT.");
    }

    if (!account) {
      client = new Appwrite.Client()
        .setEndpoint(config.endpoint)
        .setProject(config.projectId);

      account = new Appwrite.Account(client);
    }

    return account;
  }

  function emit(event, user, error) {
    lastUserId = user?.id || null;

    listeners.forEach(callback => {
      try {
        callback(event, user, error || null);
      } catch (e) {
        console.error("VOLT auth listener:", e);
      }
    });
  }

  async function syncProfile(user) {
    if (!user) return null;

    const db = ready();
    let preferences = {};

    try {
      preferences = await db.getPrefs();
    } catch (e) {
      console.warn("VOLT preferences could not load:", e);
    }

    return {
      id: user.$id,
      email: user.email,
      name: user.name || user.email?.split("@")[0] || "VOLT User",
      preferences: preferences || {}
    };
  }

  const cleanPreferences = preferences => ({
    preferred_country:
      preferences.preferred_country || {
        code: "ZA",
        name: "South Africa"
      },

    favourite_countries:
      Array.isArray(preferences.favourite_countries)
        ? preferences.favourite_countries.slice(0, 100)
        : [],

    language:
      ["en", "af", "zu"].includes(preferences.language)
        ? preferences.language
        : "en",

    theme: preferences.theme === true,

    accent:
      /^#[0-9a-fA-F]{6}$/.test(preferences.accent || "")
        ? preferences.accent
        : "#168cff"
  });

  window.VOLTAuth = {
    isConfigured: configured,

    
async signUp(name, email, password) {
  const db = ready();

  const cleanName = String(name || "").trim().slice(0, 30);

  if (cleanName.length < 2) {
    throw new Error("Display name must be at least 2 characters.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  let sessionCreated = false;

  try {
    const newUser = await db.create({
      userId: Appwrite.ID.unique(),
      email: email,
      password: password,
      name: cleanName
    });

    await db.createEmailPasswordSession({
      email: email,
      password: password
    });

    sessionCreated = true;

    await db.updatePrefs({
      prefs: cleanPreferences({})
    });

    await db.createEmailVerification({
      url: window.location.origin + window.location.pathname
    });

    const profile = await syncProfile(newUser);

    await db.deleteSession({
      sessionId: "current"
    });

    sessionCreated = false;

    return {
      user: profile,
      needsEmailConfirmation: true
    };

  } catch (error) {
    if (sessionCreated) {
      try {
        await db.deleteSession({
          sessionId: "current"
        });
      } catch (e) {}
    }

    throw error;
  }
},

async verifyEmail(userId, secret) {
  const db = ready();

  return await db.updateEmailVerification({
    userId: userId,
    secret: secret
  });
},
    async signIn(email, password) {
      const db = ready();

      await db.createEmailPasswordSession({
        email: email,
        password: password
      });

      const user = await db.get();
      const profile = await syncProfile(user);

      emit("SIGNED_IN", profile);

      return profile;
    },

    async updateProfile(name) {
      const db = ready();
      const cleanName = String(name || "").trim().slice(0, 30);

      if (cleanName.length < 2) {
        throw new Error("Display name must be at least 2 characters.");
      }

      await db.updateName({ name: cleanName });

      const user = await db.get();
      const profile = await syncProfile(user);

      emit("USER_UPDATED", profile);

      return profile;
    },

    async updatePreferences(preferences) {
      const db = ready();

      const clean = cleanPreferences(preferences);

      await db.updatePrefs({ prefs: clean });

      return clean;
    },

    async resetPassword(email) {
      const db = ready();

      const token = await db.createRecoveryOTP({
        email: email
      });

      const code = window.prompt(
        "If this email belongs to a VOLT account, Appwrite will send a 6-digit recovery code. Enter that code here:"
      );

      if (!code) {
        return;
      }

      const newPassword = window.prompt(
        "Enter your new password (at least 8 characters):"
      );

      if (!newPassword || newPassword.length < 8) {
        throw new Error("The new password must be at least 8 characters.");
      }

      await db.updateRecoveryOTP({
        userId: token.userId,
        secret: code.trim(),
        password: newPassword
      });

      window.alert("Your password has been changed. Please log in using your new password.");
    },

    async signOut() {
      const db = ready();

      await db.deleteSession({
        sessionId: "current"
      });

      emit("SIGNED_OUT", null);
    },

    async currentUser() {
      const db = ready();

      try {
        const user = await db.get();
        return await syncProfile(user);
      } catch (e) {
        if (
          e.code === 401 ||
          e.type === "general_unauthorized_scope" ||
          e.type === "user_unauthorized"
        ) {
          return null;
        }

        throw e;
      }
    },

    onChange(callback) {
      if (typeof callback !== "function" || !configured()) {
        return () => {};
      }

      ready();
      listeners.add(callback);

      return () => listeners.delete(callback);
    }
  };

  // Refresh account state when the user returns to the page.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !configured()) return;

    try {
      const user = await window.VOLTAuth.currentUser();
      const currentId = user?.id || null;

      if (currentId !== lastUserId) {
        emit(currentId ? "SIGNED_IN" : "SIGNED_OUT", user);
      }
    } catch (e) {
      console.warn("VOLT session refresh:", e);
    }
  });
})();

