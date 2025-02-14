import discord
import aiohttp
import asyncio
import os
import json
import logging
import threading
import subprocess
from flask import Flask
from dotenv import load_dotenv
import random
import time

# Load environment variables with retries
MAX_RETRIES = 5
RETRY_DELAY = 5  # in seconds
TOKEN = None

for attempt in range(MAX_RETRIES):
    load_dotenv()
    TOKEN = os.getenv("DISCORD_BOT_TOKEN")
    if TOKEN:
        logging.info(f"✅ Token loaded successfully on attempt {attempt + 1}")
        break
    else:
        logging.warning(f"⚠️ Failed to load token. Retrying in {RETRY_DELAY} seconds... (Attempt {attempt + 1}/{MAX_RETRIES})")
        time.sleep(RETRY_DELAY)

if not TOKEN:
    raise RuntimeError("❌ Failed to load Discord bot token after multiple attempts.")

ALL_CARDS_CHANNEL_ID = 1335890667322216471  # Checked cards channel
SUCCESS_CARDS_CHANNEL_ID = 1338017494128136293  # Approved cards channel
LOG_FILE = "bot_debug.log"

# Flask App Setup
app = Flask(__name__)

@app.route("/")
def hello_world():
    return "Hello World!"

def run_flask():
    app.run(host="0.0.0.0", port=7860)

# Discord client setup
intents = discord.Intents.default()
intents.messages = True
intents.guilds = True
client = discord.Client(intents=intents)

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - [%(levelname)s] - %(message)s",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler()]
)

def generate_cards(bin_prefix, count=10):
    """Randomly generates card numbers in the format 5217291904932228|11|2025|611 using the provided BIN prefix."""
    cards = []
    for _ in range(count):
        card_number = f"{bin_prefix}{''.join(random.choices('0123456789', k=10))}"
        expiry_month = f"{random.randint(1, 12):02d}"
        expiry_year = f"{random.randint(2025, 2030)}"
        cvv = ''.join(random.choices("0123456789", k=3))
        card = f"{card_number}|{expiry_month}|{expiry_year}|{cvv}"
        cards.append(card)
    return cards

async def check_card(card):
    logging.info(f"🔍 Checking card: {card}")
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(f"https://cc2.ffloveryt.in/api?card={card}", timeout=None) as response:
                if response.status != 200:
                    return "error", card, f"CC2 API Error ({response.status})"
                cc2_data = await response.json()

                if cc2_data.get("status") in ["APPROVED", "SUCCESS"]:
                    return "success", card, json.dumps({"CC2 Response": cc2_data}, indent=4)
        except Exception as e:
            return "error", card, f"API Error: {e}"

    return "declined", card, json.dumps({"CC2 Response": cc2_data}, indent=4)

async def check_api_status():
    """Check if the API is online by sending a request without a card."""
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get("https://cc2.ffloveryt.in/api") as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("error") == "No card provided":
                        return "API Online ✅"
        except Exception as e:
            logging.error(f"API status check failed: {e}")
    return "API Offline ❌"

async def send_to_discord(embed):
    channel = client.get_channel(ALL_CARDS_CHANNEL_ID)
    if channel:
        async with channel.typing():
            await channel.send(embed=embed)

async def process_cards():
    try:
        logging.info("📥 Generating cards...")
        cards = generate_cards("520806", count=10)

        if not cards:
            logging.warning("⚠️ No cards generated. Waiting for new data...")
            return

        approved_cards = []

        async def process_single_card(card):
            status, checked_card, full_response = await check_card(card)
            logging.info(f"🔍 Checked Card: `{checked_card}`\n{full_response}")

            embed = discord.Embed(title="Card Check Result", color=0x00ff00 if status == "success" else 0xff0000)
            embed.add_field(name="Card", value=f"`{checked_card}`", inline=False)
            embed.add_field(name="Status", value=status.upper(), inline=True)
            embed.add_field(name="Response", value=f"```json\n{full_response}\n```", inline=False)

            await send_to_discord(embed)

            if status == "success":
                approved_cards.append(checked_card)

        for card in cards:
            await process_single_card(card)
            await asyncio.sleep(25)  # Wait for 25 seconds before checking the next card

        logging.info("✅ All cards processed and updated.")
    except Exception as e:
        logging.error(f"❌ Error: {e}")

@client.event
async def on_ready():
    logging.info(f'✅ Logged in as {client.user}')
    threading.Thread(target=run_flask).start()

    # Display the project loading screen
    print("""
  ____  _      ____    _  __  _____  
 / ___|| | ___|  _ \  | |/ / |  __ \ 
 \___ \| |/ _ \ | | | | ' /  | |__) |
  ___) | |  __/ |_| | | . \  |  ___/ 
 |____/|_|\___|____/  |_|\_\ |_|     

""")
    print("🔄 Loading Project: v1.0.0")
    print("⚙️  Developed by Ariyan Kumar")

    api_status = await check_api_status()
    print(f"⚠️ {api_status}")

    print("🚀 Initialization complete. Bot is starting...")

    await process_cards()

# Auto-install required packages
required_packages = ["discord", "aiohttp", "flask", "python-dotenv"]
installed = subprocess.run(["pip", "install", *required_packages], capture_output=True)
if installed.returncode == 0:
    print("✅ All packages installed successfully.")
else:
    print("❌ Package installation failed. Check the error messages.")

client.run(TOKEN)
