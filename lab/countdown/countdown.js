// Simple 3-second auto countdown then ask background to close popup with beep sound each second
let remaining = 3;
const el = document.getElementById('time');

// Create a short beep using Web Audio API
function playBeep(final=false){
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = final ? 880 : 440; // higher pitch for final
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch(e) { /* ignore audio errors */ }
}

function tick(){
  el.textContent = remaining;
  document.title = remaining + 's';
  playBeep(remaining === 0);
  if(remaining === 0){
    setTimeout(()=> { chrome.runtime.sendMessage({type:'closeCountdown'}); }, 300); // slight delay for final paint
    return;
  }
  remaining--;
  setTimeout(tick, 1000);
}

tick();
