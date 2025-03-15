import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";

const RPC_URL = process.env.RPC_URL || "https://dream-rpc.somnia.network";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const PING_TOKEN_ADDRESS = process.env.PING_TOKEN_ADDRESS || "";
const PONG_TOKEN_ADDRESS = process.env.PONG_TOKEN_ADDRESS || "";
const NETWORK_NAME = process.env.NETWORK_NAME || "Somnia Testnet";
const swapContractAddress = "0x6AAC14f090A35EeA150705f72D90E4CDC4a49b2C";
const swapContractABI = [
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint24", "name": "fee", "type": "uint24" },
          { "internalType": "address", "name": "recipient", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
          { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
        ],
        "internalType": "struct ExactInputSingleParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "exactInputSingle",
    "outputs": [
      { "internalType": "uint256", "name": "amountOut", "type": "uint256" }
    ],
    "stateMutability": "payable",
    "type": "function"
  }
];

const PING_ABI = [
  "function mint(address to, uint256 amount) public payable",
  "function balanceOf(address owner) view returns (uint256)"
];

const PONG_ABI = [
  "function mint(address to, uint256 amount) public payable",
  "function balanceOf(address owner) view returns (uint256)"
];

let walletInfo = {
  address: "",
  balanceNative: "0.00",
  balancePing: "0.00",
  balancePong: "0.00",
  network: NETWORK_NAME,
};
let transactionLogs = [];
let autoSwapRunning = false;
let autoSwapCancelled = false;
let claimFaucetRunning = false;
let claimFaucetCancelled = false;
let autoSendRunning = false;
let autoSendCancelled = false;
let globalWallet = null;

function getShortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}
function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}
let renderTimeout;
function safeRender() {
  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => {
    screen.render();
  }, 50);
}
function updateLogs() {
  logsBox.setContent(transactionLogs.join("\n"));
  logsBox.setScrollPerc(100);
  safeRender();
}
function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  transactionLogs.push(`${timestamp}  ${message}`);
  updateLogs();
}
function clearTransactionLogs() {
  transactionLogs = [];
  updateLogs();
  addLog("Transaction logs telah dihapus.");
}
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function delay(ms) {
  return Promise.race([
    new Promise(resolve => setTimeout(resolve, ms)),
    new Promise(resolve => {
      const interval = setInterval(() => {
        if (autoSwapCancelled || autoSendCancelled) {
          clearInterval(interval);
          resolve();
        }
      }, 1);
    })
  ]);
}
function getTokenName(address) {
  if (address.toLowerCase() === PING_TOKEN_ADDRESS.toLowerCase()) {
    return "Ping";
  } else if (address.toLowerCase() === PONG_TOKEN_ADDRESS.toLowerCase()) {
    return "Pong";
  } else {
    return address;
  }
}

async function claimFaucetPing() {
  if (claimFaucetRunning) {
    addLog("Claim Faucet Ping sedang berjalan.");
    return;
  }
  claimFaucetRunning = true;
  updateFaucetSubMenuItems();
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    let pk = PRIVATE_KEY.trim();
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    const wallet = new ethers.Wallet(pk, provider);
    const pingContract = new ethers.Contract(PING_TOKEN_ADDRESS, PING_ABI, wallet);
    const claimAmount = ethers.parseUnits("1000", 18);
    addLog("Mengklaim Faucet Ping...");
    const tx = await pingContract.mint(wallet.address, claimAmount, { value: 0 });
    addLog(`Transaksi dikirim. Tx Hash: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog("Claim Faucet Ping berhasil!");
    await delay(5000);
    updateWalletData();
  } catch (error) {
    addLog("Claim Faucet Ping gagal: " + error.message);
  } finally {
    claimFaucetRunning = false;
    updateFaucetSubMenuItems();
  }
}

async function claimFaucetPong() {
  if (claimFaucetRunning) {
    addLog("Claim Faucet Pong sedang berjalan.");
    return;
  }
  claimFaucetRunning = true;
  updateFaucetSubMenuItems();
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    let pk = PRIVATE_KEY.trim();
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    const wallet = new ethers.Wallet(pk, provider);
    const pongContract = new ethers.Contract(PONG_TOKEN_ADDRESS, PONG_ABI, wallet);
    const claimAmount = ethers.parseUnits("1000", 18);
    addLog("Mengklaim Faucet Pong...");
    const tx = await pongContract.mint(wallet.address, claimAmount, { value: 0 });
    addLog(`Transaksi dikirim. Tx Hash: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog("Claim Faucet Pong berhasil!");
    await delay(5000);
    updateWalletData();
  } catch (error) {
    addLog("Claim Faucet Pong gagal: " + error.message);
  } finally {
    claimFaucetRunning = false;
    updateFaucetSubMenuItems();
  }
}

async function updateWalletData() {
  try {
    if (!RPC_URL || !PRIVATE_KEY) {
      throw new Error("RPC_URL / PRIVATE_KEY tidak terdefinisi di .env");
    }
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    let pk = PRIVATE_KEY.trim();
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    const wallet = new ethers.Wallet(pk, provider);
    globalWallet = wallet;
    walletInfo.address = wallet.address;
    const balanceNative = await provider.getBalance(wallet.address);
    walletInfo.balanceNative = ethers.formatEther(balanceNative);
    if (PING_TOKEN_ADDRESS) {
      const pingContract = new ethers.Contract(PING_TOKEN_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
      const pingBalance = await pingContract.balanceOf(wallet.address);
      walletInfo.balancePing = ethers.formatEther(pingBalance);
    }
    if (PONG_TOKEN_ADDRESS) {
      const pongContract = new ethers.Contract(PONG_TOKEN_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
      const pongBalance = await pongContract.balanceOf(wallet.address);
      walletInfo.balancePong = ethers.formatEther(pongBalance);
    }
    updateWallet();
    addLog("Saldo & Wallet Updated !!");
  } catch (error) {
    addLog("Gagal mengambil data wallet: " + error.message);
  }
}

function updateWallet() {
  const shortAddress = walletInfo.address ? getShortAddress(walletInfo.address) : "N/A";
  const content = ` Address : ${shortAddress}
 STT     : ${walletInfo.balanceNative}
 Ping    : ${walletInfo.balancePing}
 Pong    : ${walletInfo.balancePong}
 Network : ${walletInfo.network}
`;
  walletBox.setContent(content);
  safeRender();
}

async function checkAndApproveToken(tokenAddress, spender, amount) {
  const erc20ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];
  const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, globalWallet);
  const currentAllowance = await tokenContract.allowance(globalWallet.address, spender);
  if (currentAllowance < amount) {
    addLog(`Approval diperlukan untuk token ${getShortAddress(tokenAddress)}. Allowance saat ini: ${ethers.formatEther(currentAllowance)}`);
    const maxApproval = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const tx = await tokenContract.approve(spender, maxApproval);
    addLog(`Approval TX dikirim: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog("Approval berhasil.");
  } else {
    addLog("Token sudah di-approve.");
  }
}

async function autoSwapPingPong(totalSwaps) {
  try {
    if (!globalWallet) throw new Error("Wallet belum diinisialisasi.");
    const swapContract = new ethers.Contract(swapContractAddress, swapContractABI, globalWallet);
    addLog(`Mulai Auto Swap sebanyak ${totalSwaps} kali.`);
    for (let i = 0; i < totalSwaps; i++) {
      if (autoSwapCancelled) {
        addLog("Auto Swap dibatalkan.");
        break;
      }
      const swapDirection = Math.random() < 0.5 ? "PongToPing" : "PingToPong";
      let tokenIn, tokenOut;
      if (swapDirection === "PongToPing") {
        tokenIn = PONG_TOKEN_ADDRESS;
        tokenOut = PING_TOKEN_ADDRESS;
      } else {
        tokenIn = PING_TOKEN_ADDRESS;
        tokenOut = PONG_TOKEN_ADDRESS;
      }
      const randomAmount = randomInRange(100, 500);
      const amountIn = ethers.parseUnits(randomAmount.toString(), 18);
      const tokenInName = getTokenName(tokenIn);
      const tokenOutName = getTokenName(tokenOut);
      addLog(`Swap ${i + 1}: Sedang melakukan swap dari ${tokenInName} -> ${tokenOutName} dengan amount ${randomAmount}`);
      await checkAndApproveToken(tokenIn, swapContractAddress, amountIn);
      const fee = 500;
      const recipient = globalWallet.address;
      const amountOutMin = 0;
      const sqrtPriceLimitX96 = 0n;
      try {
        const tx = await swapContract.exactInputSingle({
          tokenIn: tokenIn,
          tokenOut: tokenOut,
          fee: fee,
          recipient: recipient,
          amountIn: amountIn,
          amountOutMinimum: amountOutMin,
          sqrtPriceLimitX96: sqrtPriceLimitX96
        });
        addLog(`Swap ${i + 1} TX dikirim: ${getShortHash(tx.hash)}`);
        await tx.wait();
        addLog(`Swap ${i + 1} berhasil.`);
        await updateWalletData();
      } catch (error) {
        addLog(`Swap ${i + 1} gagal: ${error.message}`);
      }
      if (i < totalSwaps - 1) {
        const delayMs = randomInRange(20000, 50000);
        addLog(`Menunggu ${delayMs / 1000} detik sebelum swap berikutnya...`);
        await delay(delayMs);
      }
    }
    addLog("Auto Swap selesai.");
    autoSwapRunning = false;
    updateSomniaSubMenuItems();
    updateFaucetSubMenuItems();
  } catch (err) {
    addLog("Error pada Auto Swap: " + err.message);
    autoSwapRunning = false;
    updateSomniaSubMenuItems();
    updateFaucetSubMenuItems();
  }
}

function readRandomAddresses() {
  try {
    const data = fs.readFileSync("randomaddress.txt", "utf8");
    return data.split("\n").map(addr => addr.trim()).filter(addr => addr !== "");
  } catch (err) {
    addLog("Gagal membaca file randomaddress.txt: " + err.message);
    return [];
  }
}

async function autoSendTokenRandom(totalSends, tokenAmountStr) {
  try {
    if (!globalWallet) throw new Error("Wallet belum diinisialisasi.");
    const addresses = readRandomAddresses();
    if (addresses.length === 0) {
      addLog("Daftar alamat kosong.");
      return;
    }
    addLog(`Mulai Auto Send Token ke alamat random sebanyak ${totalSends} kali.`);
    for (let i = 0; i < totalSends; i++) {
      if (autoSendCancelled) {
        addLog("Auto Send Token dibatalkan.");
        break;
      }
      const randomIndex = randomInRange(0, addresses.length - 1);
      const targetAddress = addresses[randomIndex];
      addLog(`Auto Send: Mengirim ${tokenAmountStr} STT ke ${targetAddress}`);
      const tx = await globalWallet.sendTransaction({
        to: targetAddress,
        value: ethers.parseUnits(tokenAmountStr, 18)
      });
      addLog(`Auto Send ${i + 1}/${totalSends} TX dikirim: ${getShortHash(tx.hash)}`);
      await tx.wait();
      addLog(`Auto Send ${i + 1}/${totalSends} berhasil ke ${targetAddress}.`);
      await updateWalletData();
      if (i < totalSends - 1) {
        const delayMs = randomInRange(5000, 10000);
        addLog(`Menunggu ${delayMs / 1000} detik sebelum pengiriman berikutnya...`);
        await delay(delayMs);
      }
    }
    addLog("Auto Send Token selesai.");
    autoSendRunning = false;
    updateSendTokenSubMenuItems();
  } catch (err) {
    addLog("Error pada Auto Send Token: " + err.message);
    autoSendRunning = false;
    updateSendTokenSubMenuItems();
  }
}

async function autoSendTokenChosen(targetAddress, tokenAmountStr) {
  try {
    if (!globalWallet) throw new Error("Wallet belum diinisialisasi.");
    addLog(`Mengirim ${tokenAmountStr} STT ke alamat ${targetAddress}`);
    const tx = await globalWallet.sendTransaction({
      to: targetAddress,
      value: ethers.parseUnits(tokenAmountStr, 18)
    });
    addLog(`Transaksi dikirim. Tx Hash: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog(`Pengiriman token ke ${targetAddress} berhasil.`);
    autoSendRunning = false;
    updateSendTokenSubMenuItems();
    await updateWalletData();
  } catch (err) {
    addLog("Error pada Send Token: " + err.message);
    autoSendRunning = false;
    updateSendTokenSubMenuItems();
  }
}

function updateSomniaSubMenuItems() {
  if (autoSwapRunning) {
    somniaSubMenu.setItems([
      "Auto Swap PING & PONG",
      "Stop Transaction",
      "Clear Transaction Logs",
      "Back To Main Menu",
      "Exit"
    ]);
  } else {
    somniaSubMenu.setItems([
      "Auto Swap PING & PONG",
      "Clear Transaction Logs",
      "Back To Main Menu",
      "Exit"
    ]);
  }
  safeRender();
}
function updateFaucetSubMenuItems() {
  if (autoSwapRunning || claimFaucetRunning) {
    faucetSubMenu.setItems([
      "Claim Faucet Ping (disabled)",
      "Claim Faucet Pong (disabled)",
      "Stop Transaction",
      "Clear Transaction Logs",
      "Back To Main Menu",
      "Exit"
    ]);
  } else {
    faucetSubMenu.setItems([
      "Claim Faucet Ping",
      "Claim Faucet Pong",
      "Clear Transaction Logs",
      "Back To Main Menu",
      "Exit"
    ]);
  }
  safeRender();
}
function updateSendTokenSubMenuItems() {
  if (autoSendRunning) {
    sendTokenSubMenu.setItems([
      "Auto Send Random Address (disabled)",
      "Send To Choosen Address (disabled)",
      "Stop Transaction",
      "Clear Transaction Logs",
      "Back To Menu",
      "Exit"
    ]);
  } else {
    sendTokenSubMenu.setItems([
      "Auto Send Random Address",
      "Send To Choosen Address",
      "Clear Transaction Logs",
      "Back To Menu",
      "Exit"
    ]);
  }
  safeRender();
}

const screen = blessed.screen({
  smartCSR: true,
  title: "Somnia Testnet Auto Swap, Claim Faucet & Auto Send Token",
  fullUnicode: true,
  mouse: true
});
const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  height: 7,
  tags: true,
  style: { fg: "white" }
});
figlet.text("SOMNIA AUTO SWAP", { font: "Standard", horizontalLayout: "default" }, (err, data) => {
  if (err) {
    headerBox.setContent("{center}{bold}SOMNIA AUTO SWAP{/bold}{/center}");
  } else {
    headerBox.setContent(`{center}{bold}{green-fg}${data}{/green-fg}{/bold}{/center}`);
  }
  safeRender();
});
const descriptionBox = blessed.box({
  top: 7,
  left: "center",
  width: "100%",
  height: 2,
  content: "{center}{bold}{bright-magenta-fg}=== Telegram Channel 🚀 : NT Exhaust (@NTExhaust) ==={/bright-magenta-fg}{/bold}{/center}",
  tags: true,
  style: { fg: "white" }
});
const logsBox = blessed.box({
  label: " Transaction Logs ",
  top: 10,
  left: 0,
  width: "60%",
  height: "100%-10",
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: true,
  vi: true,
  tags: true,
  scrollbar: { ch: " ", inverse: true, style: { bg: "blue" } },
  content: "",
  style: {
    border: { fg: "red" },
    fg: "bright-cyan",
    bg: "black"
  }
});
const walletBox = blessed.box({
  label: " Informasi Wallet ",
  top: 10,
  left: "60%",
  width: "40%",
  height: "28%",
  border: { type: "line" },
  style: {
    border: { fg: "magenta" },
    fg: "white",
    bg: "black",
    align: "left",
    valign: "top"
  },
  content: ""
});
const mainMenu = blessed.list({
  label: " Menu ",
  top: "66%",
  left: "60%",
  width: "40%",
  height: "40%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    selected: { bg: "green", fg: "black" },
    border: { fg: "yellow" },
    fg: "white"
  },
  items: ["Somnia Auto Swap", "Claim Faucet", "Auto Send Token", "Clear Transaction Logs", "Refresh", "Exit"]
});

const somniaSubMenu = blessed.list({
  label: " Somnia Auto Swap Menu ",
  top: "65%",
  left: "60%",
  width: "40%",
  height: "35%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    selected: { bg: "blue", fg: "white" },
    border: { fg: "yellow" },
    fg: "white"
  },
  items: []
});
somniaSubMenu.hide();
const faucetSubMenu = blessed.list({
  label: " Claim Faucet Menu ",
  top: "65%",
  left: "60%",
  width: "40%",
  height: "35%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    selected: { bg: "blue", fg: "white" },
    border: { fg: "yellow" },
    fg: "white"
  },
  items: []
});
faucetSubMenu.hide();
const sendTokenSubMenu = blessed.list({
  label: " Auto Send Token Menu ",
  top: "65%",
  left: "60%",
  width: "40%",
  height: "35%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: {
    selected: { bg: "magenta", fg: "white" },
    border: { fg: "yellow" },
    fg: "white"
  },
  items: []
});
sendTokenSubMenu.hide();
const promptBox = blessed.prompt({
  parent: screen,
  border: "line",
  height: 5,
  width: "50%",
  top: "center",
  left: "center",
  label: "{bright-blue-fg}Swap Prompt{/bright-blue-fg}",
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
  style: { fg: "bright-white", bg: "black", border: { fg: "red" } }
});

screen.append(headerBox);
screen.append(descriptionBox);
screen.append(logsBox);
screen.append(walletBox);
screen.append(mainMenu);
screen.append(somniaSubMenu);
screen.append(faucetSubMenu);
screen.append(sendTokenSubMenu);
screen.key(["escape", "q", "C-c"], () => process.exit(0));
screen.key(["C-up"], () => {
  logsBox.scroll(-1);
  safeRender();
});
screen.key(["C-down"], () => {
  logsBox.scroll(1);
  safeRender();
});
safeRender();
mainMenu.focus();
updateLogs();
safeRender();
updateWalletData();
mainMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Somnia Auto Swap") {
    showSomniaSubMenu();
  } else if (selected === "Claim Faucet") {
    showFaucetSubMenu();
  } else if (selected === "Auto Send Token") {
    showSendTokenSubMenu();
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Refresh") {
    updateWalletData();
    updateLogs();
    safeRender();
    addLog("Refreshed");
    mainMenu.focus();
  } else if (selected === "Exit") {
    process.exit(0);
  }
});

function showSomniaSubMenu() {
  mainMenu.hide();
  faucetSubMenu.hide();
  sendTokenSubMenu.hide();
  updateSomniaSubMenuItems();
  somniaSubMenu.show();
  somniaSubMenu.focus();
  safeRender();
}
somniaSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Auto Swap PING & PONG") {
    if (autoSwapRunning) {
      addLog("Transaksi sedang berlangsung, tidak bisa memulai transaksi baru.");
      return;
    }
    promptBox.setFront();
    promptBox.readInput("Masukkan jumlah swap:", "", async (err, value) => {
      promptBox.hide();
      safeRender();
      if (err || !value) {
        addLog("Input tidak valid atau dibatalkan.");
        return;
      }
      const totalSwaps = parseInt(value);
      if (isNaN(totalSwaps) || totalSwaps <= 0) {
        addLog("Jumlah swap tidak valid.");
        return;
      }
      autoSwapRunning = true;
      autoSwapCancelled = false;
      updateSomniaSubMenuItems();
      updateFaucetSubMenuItems();
      await autoSwapPingPong(totalSwaps);
      autoSwapRunning = false;
      updateSomniaSubMenuItems();
      updateFaucetSubMenuItems();
    });
  } else if (selected === "Stop Transaction") {
    if (!autoSwapRunning) {
      addLog("Tidak ada transaksi yang berjalan.");
      return;
    }
    autoSwapCancelled = true;
    addLog("Perintah Stop Transaction diterima (Somnia).");
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Back To Main Menu") {
    somniaSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Exit") {
    process.exit(0);
  }
});

function showFaucetSubMenu() {
  mainMenu.hide();
  somniaSubMenu.hide();
  sendTokenSubMenu.hide();
  updateFaucetSubMenuItems();
  faucetSubMenu.show();
  faucetSubMenu.focus();
  safeRender();
}
faucetSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Stop Transaction") {
    if (autoSwapRunning || claimFaucetRunning) {
      claimFaucetCancelled = true;
      addLog("Perintah Stop Transaction diterima (Faucet).");
    } else {
      addLog("Tidak ada transaksi yang berjalan.");
    }
    return;
  }
  if ((autoSwapRunning || claimFaucetRunning) && (selected.includes("Claim Faucet Ping") || selected.includes("Claim Faucet Pong"))) {
    addLog("Transaksi sedang berlangsung. Harap stop transaction terlebih dahulu sebelum melakukan claim faucet.");
    return;
  }
  if (selected.includes("Claim Faucet Ping")) {
    claimFaucetPing();
  } else if (selected.includes("Claim Faucet Pong")) {
    claimFaucetPong();
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Back To Main Menu") {
    faucetSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Exit") {
    process.exit(0);
  }
});

function showSendTokenSubMenu() {
  mainMenu.hide();
  somniaSubMenu.hide();
  faucetSubMenu.hide();
  updateSendTokenSubMenuItems();
  sendTokenSubMenu.show();
  sendTokenSubMenu.focus();
  safeRender();
}

sendTokenSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Auto Send Random Address") {
    if (autoSendRunning) {
      addLog("Transaksi Auto Send sedang berjalan, tidak bisa memulai transaksi baru.");
      return;
    }
    promptBox.setFront();
    promptBox.readInput("Masukkan jumlah pengiriman:", "", async (err, value) => {
      promptBox.hide();
      safeRender();
      if (err || !value) {
        addLog("Input jumlah pengiriman tidak valid atau dibatalkan.");
        return;
      }
      const totalSends = parseInt(value);
      if (isNaN(totalSends) || totalSends <= 0) {
        addLog("Jumlah pengiriman tidak valid.");
        return;
      }
      promptBox.setFront();
      promptBox.readInput("Masukkan nominal token (STT) yang akan dikirim (min 0.0001, max 0.01):", "", async (err2, tokenAmt) => {
        promptBox.hide();
        safeRender();
        if (err2 || !tokenAmt) {
          addLog("Input nominal token tidak valid atau dibatalkan.");
          return;
        }
        let amt = parseFloat(tokenAmt);
        if (isNaN(amt)) {
          addLog("Nominal token harus berupa angka.");
          return;
        }
        if (amt < 0.0001 || amt > 0.01) {
          addLog("Nominal token harus antara 0.0001 dan 0.01 STT.");
          return;
        }
        autoSendRunning = true;
        autoSendCancelled = false;
        updateSendTokenSubMenuItems();
        await autoSendTokenRandom(totalSends, tokenAmt);
        autoSendRunning = false;
        updateSendTokenSubMenuItems();
      });
    });
  } else if (selected === "Send To Choosen Address") {
    if (autoSendRunning) {
      addLog("Transaksi Auto Send sedang berjalan, tidak bisa memulai transaksi baru.");
      return;
    }
    promptBox.setFront();
    promptBox.readInput("Masukkan alamat tujuan:", "", async (err, target) => {
      promptBox.hide();
      safeRender();
      if (err || !target) {
        addLog("Input alamat tidak valid atau dibatalkan.");
        return;
      }
      promptBox.setFront();
      promptBox.readInput("Masukkan nominal token (STT) yang akan dikirim :", "", async (err2, tokenAmt) => {
        promptBox.hide();
        safeRender();
        if (err2 || !tokenAmt) {
          addLog("Input nominal token tidak valid atau dibatalkan.");
          return;
        }
        let amt = parseFloat(tokenAmt);
        if (isNaN(amt)) {
          addLog("Nominal token harus berupa angka.");
          return;
        }
        autoSendRunning = true;
        autoSendCancelled = false;
        updateSendTokenSubMenuItems();
        await autoSendTokenChosen(target, tokenAmt);
        autoSendRunning = false;
        updateSendTokenSubMenuItems();
      });
    });
  } else if (selected === "Stop Transaction") {
    if (autoSendRunning) {
      autoSendCancelled = true;
      addLog("Perintah Stop Transaction diterima (Auto Send).");
    } else {
      addLog("Tidak ada transaksi yang berjalan.");
    }
    return;
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Back To Menu") {
    sendTokenSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Exit") {
    process.exit(0);
  }
});