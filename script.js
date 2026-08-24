(function(){
  var toggle = document.getElementById('themeToggle');
  if(toggle){
    toggle.addEventListener('click', function(){
      var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try{ localStorage.setItem('wmw_theme', next); }catch(e){}
    });
  }
})();

(function(){
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".segbtn"));
  var pill = document.getElementById("pill");
  var nav = document.querySelector(".segnav");
  var sections = buttons.map(function(btn){
    return document.getElementById(btn.dataset.target);
  });

  var colorVar = {
    coral:  "var(--coral-soft)",
    indigo: "var(--indigo-soft)",
    teal:   "var(--teal-soft)"
  };

  function movePill(index){
    var btn = buttons[index];
    if(!btn || !pill) return;
    pill.style.left = btn.offsetLeft + "px";
    pill.style.width = btn.offsetWidth + "px";
    pill.style.background = colorVar[btn.dataset.color] || colorVar.coral;
  }

  function setActive(index){
    buttons.forEach(function(btn, i){
      btn.classList.toggle("active", i === index);
    });
    movePill(index);
  }

  buttons.forEach(function(btn, i){
    btn.addEventListener("click", function(){
      var target = sections[i];
      if(target){
        target.scrollIntoView({behavior:"smooth", block:"start"});
      }
      setActive(i);
    });
  });

  if("IntersectionObserver" in window){
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          var idx = sections.indexOf(entry.target);
          if(idx !== -1) setActive(idx);
        }
      });
    }, { rootMargin: "-40% 0px -50% 0px", threshold: 0 });

    sections.forEach(function(sec){
      if(sec) observer.observe(sec);
    });
  }

  window.addEventListener("load", function(){ setActive(0); });
  window.addEventListener("resize", function(){
    var activeIdx = buttons.findIndex(function(b){ return b.classList.contains("active"); });
    movePill(activeIdx === -1 ? 0 : activeIdx);
  });

  // ---- Notepad page-flip for diary entries ----
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var flipTicking = false;

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

  function updateFlipPages(){
    var pages = Array.prototype.slice.call(document.querySelectorAll(".diary-entry"));
    if(!pages.length) return;
    var vh = window.innerHeight;
    var flipStart = vh * 0.32;
    var flipRange = vh * 0.62;

    pages.forEach(function(page, i){
      var rect = page.getBoundingClientRect();
      var progress = clamp((flipStart - rect.top) / flipRange, 0, 1);
      var angle = progress * -115;
      var scale = 1 - progress * 0.05;
      var opacity = 1 - progress * 0.92;

      page.style.transform = "rotateX(" + angle + "deg) scale(" + scale + ")";
      page.style.opacity = opacity;
      page.style.zIndex = pages.length - i;
      page.style.pointerEvents = progress > 0.6 ? "none" : "auto";
    });
    flipTicking = false;
  }

  function onFlipScroll(){
    if(!flipTicking){
      window.requestAnimationFrame(updateFlipPages);
      flipTicking = true;
    }
  }

  if(!reduceMotion){
    window.addEventListener("scroll", onFlipScroll, { passive:true });
    window.addEventListener("resize", onFlipScroll);
  }

  // ---- Load poems (Worker API first, static file fallback) ----
  var WORKER_API_BASE = "https://wmw-poems-api.ash-bhagat0511.workers.dev"; // live poems API

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function renderDiary(poems){
    var container = document.getElementById("diary-container");
    if(!container) return;
    container.innerHTML = "";
    poems.forEach(function(poem, i){
      var art = document.createElement("article");
      art.className = "diary-entry" + (i % 2 === 1 ? " diary-entry-alt" : "");
      var bodyHtml = poem.body.map(escapeHtml).join("<br>\n");
      art.innerHTML =
        '<div class="diary-entry-inner">' +
          '<div class="diary-dateline">' +
            '<span class="diary-date">' + escapeHtml(poem.date || "") + "</span>" +
            '<span class="diary-rule"></span>' +
          "</div>" +
          '<h3 class="diary-title">' + escapeHtml(poem.title) + "</h3>" +
          '<p class="poem-body">' + bodyHtml + "</p>" +
          '<p class="diary-sign">' + escapeHtml(poem.sign || "— A.B.") + "</p>" +
        "</div>";
      container.appendChild(art);
    });
    if(!reduceMotion) updateFlipPages();
  }

  function loadPoemsFromWorker(){
    return fetch(WORKER_API_BASE + "/poems").then(function(r){
      if(!r.ok) throw new Error("bad status");
      return r.json();
    });
  }

  function loadPoemsFromStaticFile(){
    return fetch("poems.json").then(function(r){ return r.json(); });
  }

  var poemLoader = WORKER_API_BASE ? loadPoemsFromWorker() : loadPoemsFromStaticFile();
  poemLoader
    .then(renderDiary)
    .catch(function(){
      loadPoemsFromStaticFile().then(renderDiary).catch(function(){
        var container = document.getElementById("diary-container");
        if(container) container.innerHTML = '<p class="station-note">Poems will appear here soon.</p>';
      });
    });

  // ---- Suggestion box toggle + submit feedback ----
  var suggestToggle = document.getElementById("suggestToggle");
  var suggestForm = document.getElementById("suggestForm");
  var suggestStatus = document.getElementById("suggestStatus");

  if(suggestToggle && suggestForm){
    suggestToggle.addEventListener("click", function(){
      suggestForm.hidden = !suggestForm.hidden;
    });

    suggestForm.addEventListener("submit", function(e){
      e.preventDefault();
      var formData = new FormData(suggestForm);
      suggestStatus.textContent = "Sending…";
      fetch(suggestForm.action, { method: "POST", body: formData, headers: { Accept: "application/json" } })
        .then(function(r){ return r.json(); })
        .then(function(data){
          if(data.success){
            suggestStatus.textContent = "Thanks — sent!";
            suggestForm.reset();
          } else {
            suggestStatus.textContent = "Something went wrong. Try again later.";
          }
        })
        .catch(function(){
          suggestStatus.textContent = "Could not send. Check your connection.";
        });
    });
  }
})();
