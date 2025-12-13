"""
Netflix Session Login & Cookie Saver
=====================================
Opens Netflix, allows manual login, then saves all session data
(cookies, localStorage, sessionStorage) for reuse by the scraper.

Run this FIRST before using the scraper!
"""

import asyncio
import json
import os
from datetime import datetime
from playwright.async_api import async_playwright

# Configuration
NETFLIX_URL = "https://www.netflix.com/browse"
LOGIN_URL = "https://www.netflix.com/login"
COOKIES_FILE = "netflix_cookies.json"
LOCAL_STORAGE_FILE = "netflix_local_storage.json"
SESSION_STORAGE_FILE = "netflix_session_storage.json"
PLAYWRIGHT_STORAGE_FILE = "netflix_playwright_state.json"


async def save_session():
    """
    Opens Netflix for manual login and saves complete session data.
    """
    print("\n" + "="*60)
    print("🔐 NETFLIX SESSION SAVER")
    print("="*60)
    print("""
    This script will:
    1. Open Netflix in a browser
    2. Wait for you to log in manually
    3. Let you select a profile
    4. Save ALL session data for future scraping
    
    ⏰ You have 120 seconds to complete login.
    """)
    
    base_path = os.path.dirname(os.path.abspath(__file__))
    
    async with async_playwright() as p:
        # Launch visible browser
        browser = await p.chromium.launch(
            headless=False,
            channel="msedge",  # Use Edge on Windows
            args=[
                "--start-maximized",
                "--disable-blink-features=AutomationControlled",
            ]
        )
        
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        )
        
        page = await context.new_page()
        
        # Go to Netflix login
        print("🌐 Opening Netflix...")
        await page.goto(LOGIN_URL, wait_until="networkidle")
        
        print("\n⏳ Waiting 120 seconds for you to:")
        print("   1. Enter your email/password")
        print("   2. Complete any verification if asked")
        print("   3. Select your profile")
        print("\n   The browser will stay open. Take your time!\n")
        
        # Wait for user to complete login and reach browse page
        try:
            # Wait up to 120 seconds for the user to reach the browse page
            await page.wait_for_url("**/browse**", timeout=120000)
            print("✅ Login successful! Detected /browse page.")
        except:
            print("⚠ Timeout waiting for /browse page.")
            print("   If you're logged in, that's okay - we'll save what we have.")
        
        # Additional wait for page to fully load
        await asyncio.sleep(5)
        
        # Get current URL
        current_url = page.url
        print(f"\n📍 Current URL: {current_url}")
        
        # ===== SAVE COOKIES =====
        cookies = await context.cookies()
        cookies_path = os.path.join(base_path, COOKIES_FILE)
        with open(cookies_path, "w", encoding="utf-8") as f:
            json.dump(cookies, f, indent=2)
        print(f"✓ Saved {len(cookies)} cookies to {COOKIES_FILE}")
        
        # Check for critical Netflix cookies
        critical_cookies = ["NetflixId", "SecureNetflixId", "nfvdid"]
        found_critical = [c["name"] for c in cookies if c["name"] in critical_cookies]
        if len(found_critical) == len(critical_cookies):
            print("  ✅ All critical auth cookies present!")
        else:
            missing = set(critical_cookies) - set(found_critical)
            print(f"  ⚠ Missing auth cookies: {missing}")
        
        # ===== SAVE LOCAL STORAGE =====
        local_storage = await page.evaluate("""() => {
            let data = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                data[key] = localStorage.getItem(key);
            }
            return data;
        }""")
        
        ls_path = os.path.join(base_path, LOCAL_STORAGE_FILE)
        with open(ls_path, "w", encoding="utf-8") as f:
            json.dump(local_storage, f, indent=2)
        print(f"✓ Saved {len(local_storage)} localStorage items to {LOCAL_STORAGE_FILE}")
        
        # ===== SAVE SESSION STORAGE =====
        session_storage = await page.evaluate("""() => {
            let data = {};
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                data[key] = sessionStorage.getItem(key);
            }
            return data;
        }""")
        
        ss_path = os.path.join(base_path, SESSION_STORAGE_FILE)
        with open(ss_path, "w", encoding="utf-8") as f:
            json.dump(session_storage, f, indent=2)
        print(f"✓ Saved {len(session_storage)} sessionStorage items to {SESSION_STORAGE_FILE}")
        
        # ===== SAVE PLAYWRIGHT STATE (Combined) =====
        state_path = os.path.join(base_path, PLAYWRIGHT_STORAGE_FILE)
        await context.storage_state(path=state_path)
        print(f"✓ Saved Playwright storage state to {PLAYWRIGHT_STORAGE_FILE}")
        
        # Summary
        print("\n" + "="*60)
        print("🎉 SESSION SAVED SUCCESSFULLY!")
        print("="*60)
        print(f"""
    Files created:
    - {COOKIES_FILE} (browser cookies)
    - {LOCAL_STORAGE_FILE} (localStorage data)
    - {SESSION_STORAGE_FILE} (sessionStorage data)
    - {PLAYWRIGHT_STORAGE_FILE} (Playwright combined state)
    
    ✅ You can now run: python netflix_watch_scraper.py
    
    ⏰ Session typically valid for: 30 days
       (Re-run this script if you get logged out)
    """)
        
        await browser.close()


async def verify_session():
    """
    Quick verification that saved cookies are still valid.
    """
    print("\n🔍 Verifying saved session...")
    
    base_path = os.path.dirname(os.path.abspath(__file__))
    cookies_path = os.path.join(base_path, COOKIES_FILE)
    
    if not os.path.exists(cookies_path):
        print("❌ No cookies file found! Run 'save' mode first.")
        return False
    
    with open(cookies_path, "r", encoding="utf-8") as f:
        cookies = json.load(f)
    
    # Check critical cookies
    netflix_id = next((c for c in cookies if c["name"] == "NetflixId"), None)
    secure_id = next((c for c in cookies if c["name"] == "SecureNetflixId"), None)
    
    if not netflix_id or not secure_id:
        print("❌ Critical cookies missing! Session invalid.")
        return False
    
    # Check expiration
    now = datetime.now().timestamp()
    if netflix_id.get("expires", 0) < now:
        print("❌ NetflixId cookie expired! Re-login required.")
        return False
    
    expiry_date = datetime.fromtimestamp(netflix_id.get("expires", 0))
    print(f"✅ Session valid until: {expiry_date.strftime('%Y-%m-%d %H:%M:%S')}")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, channel="msedge")
        context = await browser.new_context()
        await context.add_cookies(cookies)
        
        page = await context.new_page()
        await page.goto("https://www.netflix.com/browse", wait_until="networkidle")
        
        # Check if we landed on browse page (logged in) or login page
        current_url = page.url
        
        if "/browse" in current_url:
            print("✅ Session is VALID - successfully accessed /browse")
            result = True
        else:
            print(f"❌ Session INVALID - redirected to: {current_url}")
            result = False
        
        await browser.close()
        return result


async def main():
    """Main menu."""
    print("""
    ╔══════════════════════════════════════════════════════════╗
    ║       NETFLIX SESSION MANAGER - Playwright Edition       ║
    ╚══════════════════════════════════════════════════════════╝
    
    Choose an action:
    
    [1] SAVE NEW SESSION  - Login and save cookies
    [2] VERIFY SESSION    - Check if saved cookies work
    [3] EXIT
    """)
    
    choice = input("Enter choice (1/2/3): ").strip()
    
    if choice == "1":
        await save_session()
    elif choice == "2":
        await verify_session()
    elif choice == "3":
        print("Goodbye!")
    else:
        print("Invalid choice. Running save session by default...")
        await save_session()


if __name__ == "__main__":
    asyncio.run(main())


