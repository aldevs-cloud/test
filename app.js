(function(){
  "use strict";

  var STORAGE_KEY = "taka_tracker_v1";

  var MONTHS = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];

  /* ---------------- date helpers (all local-time, no UTC surprises) ---------------- */
  function pad2(n){ return n < 10 ? "0"+n : ""+n; }
  function fmtISO(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
  function parseISO(s){
    var parts = s.split("-");
    return new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));
  }
  function todayStr(){ return fmtISO(new Date()); }
  function daysBetween(a,b){ return Math.round((b - a) / 86400000); }
  function clampDate(s, min, max){
    if(min && s < min) return min;
    if(max && s > max) return max;
    return s;
  }
  function fmtDateHuman(s){
    var d = parseISO(s);
    return d.getDate() + " " + MONTHS[d.getMonth()] + ", " + d.getFullYear();
  }
  function fmtMoney(n){
    n = Math.round(Number(n) || 0);
    return "৳" + n.toLocaleString("en-IN");
  }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  /* ---------------- state ---------------- */
  var state = null;

  function defaultState(){
    return { setup: null, topups: [], entries: {}, quickNotes: {}, plans: [], activePlanId: null, bills: [], activeBillId: null };
  }

  function getTotals(){
    var totalBalance = (state.setup ? Number(state.setup.initialBalance) : 0) +
      state.topups.reduce(function(s,t){ return s + Number(t.amount||0); }, 0);
    var totalSpent = Object.keys(state.entries).reduce(function(s,k){
      return s + Number(state.entries[k].amount || 0);
    }, 0);
    return { totalBalance: totalBalance, totalSpent: totalSpent, remaining: totalBalance - totalSpent };
  }

  function getDaysInfo(){
    if(!state.setup) return { daysTotal:0, daysPassed:0, daysLeft:0 };
    var start = state.setup.startDate, end = state.setup.endDate;
    var daysTotal = daysBetween(parseISO(start), parseISO(end)) + 1;
    var today = todayStr();
    var passed;
    if(today < start) passed = 0;
    else if(today > end) passed = daysTotal;
    else passed = daysBetween(parseISO(start), parseISO(today)) + 1;
    var left = Math.max(daysTotal - passed, 0);
    return { daysTotal: daysTotal, daysPassed: passed, daysLeft: left };
  }

  /* ---------------- DOM refs ---------------- */
  var $ = function(id){ return document.getElementById(id); };

  var onboarding = $("onboarding"), mainApp = $("mainApp");

  /* ---------------- dashboard ---------------- */
  function renderDashboard(){
    if(!state.setup) return;
    var t = getTotals(), d = getDaysInfo();

    $("periodLabel").textContent = fmtDateHuman(state.setup.startDate) + " – " + fmtDateHuman(state.setup.endDate);
    $("remainingAmount").textContent = fmtMoney(t.remaining);
    $("spentAmount").textContent = fmtMoney(t.totalSpent);
    $("daysPassedNum").textContent = d.daysPassed;
    $("daysLeftNum").textContent = d.daysLeft;

    var heroEl = document.querySelector(".hero-balance");
    heroEl.classList.toggle("over-budget", t.remaining < 0);

    var suggestEl = $("suggestBudget");
    if(d.daysLeft > 0){
      var perDay = Math.max(t.remaining, 0) / d.daysLeft;
      suggestEl.textContent = "প্রতিদিন গড়ে " + fmtMoney(perDay) + " করে খরচ করলে শেষ দিন পর্যন্ত চলবে";
    } else if(t.remaining < 0){
      suggestEl.textContent = "নির্ধারিত সময় শেষ, বরাদ্দের চেয়ে বেশি খরচ হয়ে গেছে";
    } else {
      suggestEl.textContent = "নির্ধারিত সময় শেষ হয়ে গেছে";
    }
  }

  /* ---------------- tabs ---------------- */
  var tabs = ["add","calendar","history","settings","plans","bills"];
  function switchTab(name){
    tabs.forEach(function(t){
      $("tab-"+t).classList.toggle("hidden", t !== name);
    });
    document.querySelectorAll(".nav-btn").forEach(function(b){
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll("#bottomTabs button").forEach(function(b){
      b.classList.toggle("active", b.dataset.tab === name);
    });
    if(name === "calendar") renderCalendar();
    if(name === "history") renderHistory();
    if(name === "settings") fillSettingsForm();
    if(name === "plans") renderPlans();
    if(name === "bills"){ renderBills(); if(!billDtTouched) resetBillDateTime(); }
  }
  document.querySelectorAll(".nav-btn, #bottomTabs button").forEach(function(btn){
    btn.addEventListener("click", function(){ switchTab(btn.dataset.tab); });
  });

  /* ---------------- add / edit entry ---------------- */
  var entryDateInput = $("entryDate"), entryAmountInput = $("entryAmount"), entryNoteInput = $("entryNote");
  var noteToggle = document.querySelector(".note-toggle");
  var deleteEntryBtn = $("deleteEntryBtn"), addTitle = $("addTitle");

  function loadEntryForDate(dateStr){
    var existing = state.entries[dateStr];
    if(existing){
      entryAmountInput.value = existing.amount || "";
      entryNoteInput.value = existing.note || "";
      noteToggle.open = !!(existing.note && existing.note.trim());
      deleteEntryBtn.classList.remove("hidden");
      addTitle.textContent = fmtDateHuman(dateStr) + " তারিখের খরচ সম্পাদনা করুন";
    } else {
      entryAmountInput.value = "";
      entryNoteInput.value = "";
      noteToggle.open = false;
      deleteEntryBtn.classList.add("hidden");
      addTitle.textContent = fmtDateHuman(dateStr) + " তারিখের খরচ যোগ করুন";
    }
    $("calcOut").value = ""; $("calcIn").value = ""; $("calcResult").textContent = fmtMoney(0);
    renderTallyList(dateStr);
  }

  entryDateInput.addEventListener("change", function(){
    loadEntryForDate(entryDateInput.value);
  });

  $("entryForm").addEventListener("submit", function(e){
    e.preventDefault();
    var dateStr = entryDateInput.value;
    if(!dateStr) return;
    var amount = Number(entryAmountInput.value || 0);
    var note = entryNoteInput.value.trim();
    state.entries[dateStr] = { amount: amount, note: note };
    save();
    renderDashboard();
    loadEntryForDate(dateStr);
    renderCalendarIfVisible();
  });

  deleteEntryBtn.addEventListener("click", function(){
    var dateStr = entryDateInput.value;
    if(!state.entries[dateStr]) return;
    if(!confirm(fmtDateHuman(dateStr) + " তারিখের হিসাব মুছে ফেলতে চান?")) return;
    delete state.entries[dateStr];
    save();
    renderDashboard();
    loadEntryForDate(dateStr);
    renderCalendarIfVisible();
  });

  function renderCalendarIfVisible(){
    if(!$("tab-calendar").classList.contains("hidden")) renderCalendar();
  }

  /* ---------------- helper tools: calculator ---------------- */
  var helperTabBtns = document.querySelectorAll(".helper-tab-btn");
  helperTabBtns.forEach(function(btn){
    btn.addEventListener("click", function(){
      helperTabBtns.forEach(function(b){ b.classList.toggle("active", b === btn); });
      $("helper-calc").classList.toggle("hidden", btn.dataset.helper !== "calc");
      $("helper-tally").classList.toggle("hidden", btn.dataset.helper !== "tally");
    });
  });

  function recalcCalc(){
    var out = Number($("calcOut").value || 0), inn = Number($("calcIn").value || 0);
    var result = Math.max(out - inn, 0);
    $("calcResult").textContent = fmtMoney(result);
    return result;
  }
  $("calcOut").addEventListener("input", recalcCalc);
  $("calcIn").addEventListener("input", recalcCalc);
  $("useCalcBtn").addEventListener("click", function(){
    entryAmountInput.value = recalcCalc();
  });

  /* ---------------- helper tools: quick tally ---------------- */
  function renderTallyList(dateStr){
    var list = state.quickNotes[dateStr] || [];
    var container = $("tallyList");
    container.innerHTML = "";
    var total = 0;
    list.forEach(function(item){
      total += Number(item.amount || 0);
      var row = document.createElement("div");
      row.className = "tally-row";
      row.innerHTML =
        '<span class="t-desc">' + (item.desc ? escapeHtml(item.desc) : "খরচ") + '</span>' +
        '<span class="t-amt">' + fmtMoney(item.amount) + '</span>' +
        '<button type="button" class="t-del" aria-label="মুছুন">×</button>';
      row.querySelector(".t-del").addEventListener("click", function(){
        state.quickNotes[dateStr] = (state.quickNotes[dateStr]||[]).filter(function(x){ return x.id !== item.id; });
        save();
        renderTallyList(dateStr);
      });
      container.appendChild(row);
    });
    if(list.length === 0){
      container.innerHTML = '<p class="helper-hint" style="margin:0;">এখনো কিছু টোকা হয়নি</p>';
    }
    $("tallyTotal").textContent = fmtMoney(total);
  }

  function escapeHtml(s){
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  $("tallyAddBtn").addEventListener("click", function(){
    var dateStr = entryDateInput.value;
    var amount = Number($("tallyAmount").value || 0);
    if(!amount) return;
    var desc = $("tallyDesc").value.trim();
    if(!state.quickNotes[dateStr]) state.quickNotes[dateStr] = [];
    state.quickNotes[dateStr].push({ id: uid(), desc: desc, amount: amount });
    save();
    $("tallyDesc").value = ""; $("tallyAmount").value = "";
    renderTallyList(dateStr);
  });

  $("useTallyBtn").addEventListener("click", function(){
    var dateStr = entryDateInput.value;
    var list = state.quickNotes[dateStr] || [];
    var total = list.reduce(function(s,x){ return s + Number(x.amount||0); }, 0);
    entryAmountInput.value = total;
    if(!entryNoteInput.value.trim() && list.length){
      entryNoteInput.value = list.map(function(x){
        return (x.desc ? x.desc + " " : "") + fmtMoney(x.amount);
      }).join("\n");
      noteToggle.open = true;
    }
  });

  /* ---------------- calendar ---------------- */
  var calViewDate = new Date();
  function renderCalendar(){
    if(!state.setup) return;
    var y = calViewDate.getFullYear(), m = calViewDate.getMonth();
    $("calMonthLabel").textContent = MONTHS[m] + " " + y;

    var grid = $("calGrid");
    grid.innerHTML = "";
    var firstDay = new Date(y, m, 1);
    var startWeekday = firstDay.getDay();
    var daysInMonth = new Date(y, m+1, 0).getDate();
    var today = todayStr();

    for(var i=0; i<startWeekday; i++){
      var empty = document.createElement("div");
      empty.className = "cal-cell empty";
      grid.appendChild(empty);
    }
    for(var day=1; day<=daysInMonth; day++){
      var dateStr = y + "-" + pad2(m+1) + "-" + pad2(day);
      var cell = document.createElement("div");
      cell.className = "cal-cell";
      var entry = state.entries[dateStr];
      var amt = entry ? Number(entry.amount||0) : 0;

      if(dateStr < state.setup.startDate || dateStr > state.setup.endDate) cell.classList.add("out-of-range");
      if(dateStr === today) cell.classList.add("is-today");
      if(entry){
        cell.classList.add("has-spend");
        if(amt > 1000) cell.classList.add("high-spend");
      }
      cell.innerHTML = '<span class="cal-day-num">' + day + '</span>' +
        (entry ? '<span class="cal-amt">' + fmtMoney(amt) + '</span>' : '');
      cell.addEventListener("click", function(ds){
        return function(){
          switchTab("add");
          entryDateInput.value = ds;
          loadEntryForDate(ds);
        };
      }(dateStr));
      grid.appendChild(cell);
    }
  }
  $("calPrev").addEventListener("click", function(){
    calViewDate.setMonth(calViewDate.getMonth() - 1);
    renderCalendar();
  });
  $("calNext").addEventListener("click", function(){
    calViewDate.setMonth(calViewDate.getMonth() + 1);
    renderCalendar();
  });

  /* ---------------- history ---------------- */
  function renderHistory(){
    var container = $("historyList");
    var dates = Object.keys(state.entries).sort().reverse();
    if(dates.length === 0){
      container.innerHTML = '<p class="empty-state">এখনো কোনো খরচ যোগ করা হয়নি</p>';
      return;
    }
    container.innerHTML = "";
    dates.forEach(function(dateStr){
      var entry = state.entries[dateStr];
      var amt = Number(entry.amount||0);
      var item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML =
        '<div class="history-top">' +
          '<span class="history-date">' + fmtDateHuman(dateStr) + '</span>' +
          '<span class="history-amt' + (amt > 1000 ? ' high' : '') + '">' + fmtMoney(amt) + '</span>' +
        '</div>' +
        (entry.note ? '<div class="history-note">' + escapeHtml(entry.note) + '</div>' : '') +
        '<div class="history-actions">' +
          '<button type="button" class="edit">সম্পাদনা করুন</button>' +
          '<button type="button" class="del">মুছুন</button>' +
        '</div>';
      item.querySelector(".edit").addEventListener("click", function(){
        switchTab("add");
        entryDateInput.value = dateStr;
        loadEntryForDate(dateStr);
      });
      item.querySelector(".del").addEventListener("click", function(){
        if(!confirm(fmtDateHuman(dateStr) + " তারিখের হিসাব মুছে ফেলতে চান?")) return;
        delete state.entries[dateStr];
        save();
        renderDashboard();
        renderHistory();
        renderCalendarIfVisible();
      });
      container.appendChild(item);
    });
  }

  /* ---------------- expense plans (multiple named planning lists) ---------------- */
  var editingPlanItemId = null;

  function getActivePlan(){
    if(!state.activePlanId) return null;
    for(var i=0;i<state.plans.length;i++){
      if(state.plans[i].id === state.activePlanId) return state.plans[i];
    }
    return null;
  }

  function createPlan(){
    var plan = {
      id: uid(),
      title: "প্ল্যান " + (state.plans.length + 1),
      createdDate: todayStr(),
      items: []
    };
    state.plans.push(plan);
    state.activePlanId = plan.id;
    editingPlanItemId = null;
    save();
    renderPlans();
  }

  function selectPlan(id){
    state.activePlanId = id;
    editingPlanItemId = null;
    save();
    renderPlans();
  }

  function deletePlan(id){
    if(!confirm("এই প্ল্যানটি মুছে ফেলতে চান? এর সব খরচের তালিকাও মুছে যাবে।")) return;
    state.plans = state.plans.filter(function(p){ return p.id !== id; });
    if(state.activePlanId === id){
      state.activePlanId = state.plans.length ? state.plans[0].id : null;
    }
    editingPlanItemId = null;
    save();
    renderPlans();
  }

  function renamePlan(id){
    var plan = null;
    for(var i=0;i<state.plans.length;i++){ if(state.plans[i].id === id) plan = state.plans[i]; }
    if(!plan) return;
    var name = prompt("প্ল্যানের নাম লিখুন", plan.title);
    if(name === null) return;
    name = name.trim();
    if(!name) return;
    plan.title = name;
    save();
    renderPlans();
  }

  function planTotals(plan){
    var totalPlanned = 0, totalDone = 0;
    plan.items.forEach(function(it){
      totalPlanned += Number(it.amount || 0);
      if(it.done) totalDone += Number(it.amount || 0);
    });
    return { totalPlanned: totalPlanned, totalDone: totalDone, remaining: totalPlanned - totalDone };
  }

  function renderPlans(){
    var stripEl = $("planTabsStrip");
    stripEl.innerHTML = "";
    state.plans.forEach(function(p){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "plan-tab-btn" + (p.id === state.activePlanId ? " active" : "");
      btn.textContent = p.title;
      btn.addEventListener("click", function(){ selectPlan(p.id); });
      stripEl.appendChild(btn);
    });
    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "plan-tab-add";
    addBtn.textContent = "+ নতুন";
    addBtn.addEventListener("click", createPlan);
    stripEl.appendChild(addBtn);

    var plan = getActivePlan();
    if(!plan){
      $("planEmpty").classList.remove("hidden");
      $("planPanel").classList.add("hidden");
      return;
    }
    $("planEmpty").classList.add("hidden");
    $("planPanel").classList.remove("hidden");

    $("planTitle").textContent = plan.title;
    $("planCreatedLabel").textContent = "তৈরি হয়েছে: " + fmtDateHuman(plan.createdDate);

    renderPlanItems(plan);
  }

  function renderPlanItems(plan){
    var container = $("planItemsList");
    container.innerHTML = "";

    if(plan.items.length === 0){
      container.innerHTML = '<p class="empty-state">এখনো কোনো খরচ যোগ করা হয়নি</p>';
    } else {
      plan.items.forEach(function(item){
        var row = document.createElement("div");

        if(editingPlanItemId === item.id){
          row.className = "plan-item";
          row.innerHTML =
            '<div class="plan-item-edit">' +
              '<input type="text" class="edit-name">' +
              '<input type="number" class="edit-amount" min="0" step="1">' +
              '<div class="plan-item-edit-actions">' +
                '<button type="button" class="save">সেভ</button>' +
                '<button type="button" class="cancel">বাতিল</button>' +
              '</div>' +
            '</div>';
          row.querySelector(".edit-name").value = item.name;
          row.querySelector(".edit-amount").value = Number(item.amount || 0);
          row.querySelector(".save").addEventListener("click", function(){
            var name = row.querySelector(".edit-name").value.trim();
            var amount = Number(row.querySelector(".edit-amount").value || 0);
            if(!name) return;
            item.name = name;
            item.amount = amount;
            editingPlanItemId = null;
            save();
            renderPlanItems(plan);
          });
          row.querySelector(".cancel").addEventListener("click", function(){
            editingPlanItemId = null;
            renderPlanItems(plan);
          });
        } else {
          row.className = "plan-item" + (item.done ? " done" : "");
          row.innerHTML =
            '<label class="plan-check">' +
              '<input type="checkbox"' + (item.done ? " checked" : "") + '>' +
            '</label>' +
            '<div class="plan-item-main">' +
              '<span class="plan-item-name">' + escapeHtml(item.name) + '</span>' +
              '<span class="plan-item-amt">' + fmtMoney(item.amount) + '</span>' +
            '</div>' +
            (item.done ? '<div class="plan-item-date"><input type="date" class="done-date"></div>' : '') +
            '<div class="plan-item-actions">' +
              '<button type="button" class="edit" aria-label="সম্পাদনা করুন">✎</button>' +
              '<button type="button" class="del" aria-label="মুছুন">×</button>' +
            '</div>';

          if(item.done){
            row.querySelector(".done-date").value = item.completedDate || todayStr();
            row.querySelector(".done-date").addEventListener("change", function(e){
              item.completedDate = e.target.value || todayStr();
              save();
            });
          }
          row.querySelector('input[type=checkbox]').addEventListener("change", function(e){
            item.done = e.target.checked;
            if(item.done && !item.completedDate) item.completedDate = todayStr();
            save();
            renderPlanItems(plan);
          });
          row.querySelector(".edit").addEventListener("click", function(){
            editingPlanItemId = item.id;
            renderPlanItems(plan);
          });
          row.querySelector(".del").addEventListener("click", function(){
            if(!confirm('"' + item.name + '" মুছে ফেলতে চান?')) return;
            plan.items = plan.items.filter(function(x){ return x.id !== item.id; });
            save();
            renderPlanItems(plan);
          });
        }
        container.appendChild(row);
      });
    }

    var t = planTotals(plan);
    $("planTotalPlanned").textContent = fmtMoney(t.totalPlanned);
    $("planTotalDone").textContent = fmtMoney(t.totalDone);
    $("planTotalRemaining").textContent = fmtMoney(t.remaining);
  }

  $("planItemForm").addEventListener("submit", function(e){
    e.preventDefault();
    var plan = getActivePlan();
    if(!plan) return;
    var name = $("planItemName").value.trim();
    var amount = Number($("planItemAmount").value || 0);
    if(!name) return;
    plan.items.push({ id: uid(), name: name, amount: amount, done: false, completedDate: null });
    save();
    $("planItemName").value = "";
    $("planItemAmount").value = "";
    renderPlanItems(plan);
  });

  $("planRenameBtn").addEventListener("click", function(){
    var plan = getActivePlan();
    if(plan) renamePlan(plan.id);
  });

  $("planDeleteBtn").addEventListener("click", function(){
    var plan = getActivePlan();
    if(plan) deletePlan(plan.id);
  });

  $("planPdfBtn").addEventListener("click", function(){
    var plan = getActivePlan();
    if(!plan){ alert("আগে একটি প্ল্যান তৈরি করুন"); return; }
    var t = planTotals(plan);
    var rows = plan.items.map(function(it){
      return "<tr><td>" + escapeHtml(it.name) + "</td><td>" + fmtMoney(it.amount) + "</td><td>" +
        (it.done ? "সম্পন্ন" : "বাকি") + "</td><td>" +
        (it.done && it.completedDate ? fmtDateHuman(it.completedDate) : "—") + "</td></tr>";
    }).join("");
    if(!rows) rows = '<tr><td colspan="4">এখনো কোনো খরচ যোগ করা হয়নি</td></tr>';

    $("printArea").innerHTML =
      "<h1>" + escapeHtml(plan.title) + "</h1>" +
      '<p class="p-period">তৈরি হয়েছে: ' + fmtDateHuman(plan.createdDate) + " · রিপোর্ট তৈরি: " + fmtDateHuman(todayStr()) + "</p>" +
      '<div class="p-summary">' +
        "<div>মোট পরিকল্পনা<strong>" + fmtMoney(t.totalPlanned) + "</strong></div>" +
        "<div>সম্পন্ন খরচ<strong>" + fmtMoney(t.totalDone) + "</strong></div>" +
        "<div>বাকি<strong>" + fmtMoney(t.remaining) + "</strong></div>" +
      "</div>" +
      "<table><thead><tr><th>খরচের নাম</th><th>টাকা</th><th>অবস্থা</th><th>সম্পন্ন হওয়ার তারিখ</th></tr></thead><tbody>" + rows + "</tbody></table>";

    window.print();
  });

  /* ---------------- bills (recharge / balance tracker) ---------------- */
  var billKind = "recharge";
  var billDtTouched = false;

  function nowLocalStr(){
    var d = new Date();
    return fmtISO(d) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function parseDT(s){
    var p = s.split("T"), dp = p[0].split("-"), tp = (p[1] || "00:00").split(":");
    return new Date(parseInt(dp[0],10), parseInt(dp[1],10)-1, parseInt(dp[2],10), parseInt(tp[0],10), parseInt(tp[1],10));
  }
  function fmtDTHuman(s){
    return fmtDTObj(parseDT(s));
  }
  function fmtDTObj(d){
    var h = d.getHours(), ap = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12;
    var yr = d.getFullYear() !== new Date().getFullYear() ? ", " + d.getFullYear() : "";
    return d.getDate() + " " + MONTHS[d.getMonth()] + yr + " · " + h12 + ":" + pad2(d.getMinutes()) + " " + ap;
  }
  function fmtDuration(days){
    var totalHours = Math.round(days * 24);
    var d = Math.floor(totalHours / 24), h = totalHours % 24;
    if(d > 0 && h > 0) return d + " দিন " + h + " ঘণ্টা";
    if(d > 0) return d + " দিন";
    if(h > 0) return h + " ঘণ্টা";
    return "১ ঘণ্টারও কম";
  }

  function getActiveBill(){
    if(!state.activeBillId) return null;
    for(var i=0;i<state.bills.length;i++){
      if(state.bills[i].id === state.activeBillId) return state.bills[i];
    }
    return null;
  }

  /* Walks the entries in time order.
     First entry = starting point (a recharge, or a balance check if you already had money).
     Every later "balance check" tells us how much was used since the previous point:
       used = (balance we expected: last known balance + recharges since) - (balance you saw) */
  function calcBill(bill){
    var ev = bill.entries.slice().sort(function(a,b){
      if(a.dt !== b.dt) return a.dt < b.dt ? -1 : 1;
      if(a.kind !== b.kind) return a.kind === "recharge" ? -1 : 1;
      return 0;
    });
    var r = { events: ev, segs: {}, totalRecharge: 0, used: 0, hasCalc: false,
              avg: 0, days: 0, balNow: 0, tStart: null, tLast: null, daysLeft: null, endDate: null };
    if(!ev.length) return r;

    ev.forEach(function(e){ if(e.kind === "recharge") r.totalRecharge += Number(e.amount || 0); });

    var bal = Number(ev[0].amount || 0);
    var tStart = parseDT(ev[0].dt), tLast = tStart, checked = false, used = 0;

    for(var i=1;i<ev.length;i++){
      var e = ev[i], a = Number(e.amount || 0);
      if(e.kind === "recharge"){
        bal += a;
      } else {
        var u = bal - a;
        r.segs[e.id] = u;
        used += u;
        bal = a;
        tLast = parseDT(e.dt);
        checked = true;
      }
    }

    r.used = used;
    r.balNow = bal;
    r.tStart = tStart;
    r.tLast = tLast;
    r.days = (tLast - tStart) / 86400000;
    r.hasCalc = checked && r.days > 0;

    if(r.hasCalc && used > 0){
      r.avg = used / r.days;
      r.daysLeft = bal > 0 ? bal / r.avg : 0;
      r.endDate = new Date(tLast.getTime() + r.daysLeft * 86400000);
    }
    return r;
  }

  function renderBillSummary(bill){
    var box = $("billSummary");
    var r = calcBill(bill);

    if(!r.events.length){
      box.innerHTML = '<div class="bill-note">প্রথমে একটি রিচার্জ যোগ করুন। এটাই হিসাবের শুরু ধরা হবে। (আগে থেকেই ব্যালেন্স থাকলে "ব্যালেন্স দেখলাম" দিয়েও শুরু করা যায়।)</div>';
      return;
    }
    if(!r.hasCalc){
      box.innerHTML = '<div class="bill-note">এখন পর্যন্ত মোট রিচার্জ ' + fmtMoney(r.totalRecharge) +
        '। হিসাব দেখতে কিছুক্ষণ পর মিটারে ব্যালেন্স দেখে "ব্যালেন্স দেখলাম" থেকে সেটা লিখে রাখুন।</div>';
      return;
    }
    if(!(r.used > 0)){
      box.innerHTML = '<div class="bill-note">শেষ ব্যালেন্স আগের হিসাবের চেয়ে কমেনি, তাই গড় বের করা যাচ্ছে না। কোনো রিচার্জ বাদ পড়ে গেছে কি না দেখে নিন।</div>';
      return;
    }

    var low = r.daysLeft < 1;
    var leftText, endText;
    if(r.balNow <= 0){
      leftText = "ব্যালেন্স শেষ হয়ে গেছে";
      endText = "";
    } else {
      leftText = "আর প্রায় " + fmtDuration(r.daysLeft) + " চলবে";
      endText = "আনুমানিক শেষ হবে " + fmtDTObj(r.endDate);
    }

    box.innerHTML =
      '<div class="bill-hero' + (low ? ' low' : '') + '">' +
        '<span class="hero-label">শেষ চেক অনুযায়ী ব্যালেন্স (' + fmtDTObj(r.tLast) + ')</span>' +
        '<span class="hero-number">' + fmtMoney(r.balNow) + '</span>' +
        '<div class="hero-sub">' +
          '<div class="hero-sub-item"><span>' + fmtMoney(r.used) + '</span><small>এ পর্যন্ত কেটেছে</small></div>' +
          '<div class="hero-sub-item"><span>' + fmtMoney(r.avg) + '</span><small>দৈনিক গড়</small></div>' +
          '<div class="hero-sub-item"><span>' + fmtDuration(r.days) + '</span><small>সময় পার</small></div>' +
        '</div>' +
        '<p class="bill-left">' + leftText + '</p>' +
        (endText ? '<p class="suggest">' + endText + '</p>' : '') +
      '</div>';
  }

  function renderBillLog(bill){
    var container = $("billLog");
    var r = calcBill(bill);
    if(!r.events.length){
      container.innerHTML = '<p class="empty-state">এখনো কোনো এন্ট্রি নেই</p>';
      return;
    }
    container.innerHTML = "";
    r.events.slice().reverse().forEach(function(e){
      var isRecharge = e.kind === "recharge";
      var seg = r.segs[e.id];
      var segHtml = "";
      if(!isRecharge && seg !== undefined){
        segHtml = seg >= 0
          ? '<span class="bill-row-seg">আগের হিসাব থেকে ' + fmtMoney(seg) + ' কেটেছে</span>'
          : '<span class="bill-row-seg warn">ব্যালেন্স বেড়ে গেছে — কোনো রিচার্জ বাদ পড়েছে?</span>';
      }
      var row = document.createElement("div");
      row.className = "bill-row";
      row.innerHTML =
        '<span class="bill-badge' + (isRecharge ? '' : ' check') + '">' + (isRecharge ? 'রিচার্জ' : 'ব্যালেন্স') + '</span>' +
        '<div class="bill-row-main">' +
          '<span class="bill-row-amt">' + (isRecharge ? '+' : '') + fmtMoney(e.amount) + '</span>' +
          '<span class="bill-row-time">' + fmtDTHuman(e.dt) + '</span>' +
          segHtml +
        '</div>' +
        '<button type="button" class="del" aria-label="মুছুন">×</button>';
      row.querySelector(".del").addEventListener("click", function(){
        if(!confirm("এই এন্ট্রিটা মুছে ফেলতে চান?")) return;
        bill.entries = bill.entries.filter(function(x){ return x.id !== e.id; });
        save();
        renderBills();
      });
      container.appendChild(row);
    });
  }

  function resetBillDateTime(){
    $("billDateTime").value = nowLocalStr();
    billDtTouched = false;
  }

  function setBillKind(kind){
    billKind = kind;
    document.querySelectorAll(".bill-kind-btn").forEach(function(b){
      b.classList.toggle("active", b.dataset.kind === kind);
    });
    if(kind === "recharge"){
      $("billAmountLabel").textContent = "কত টাকা রিচার্জ করলেন (৳)";
      $("billSubmitBtn").textContent = "রিচার্জ যোগ করুন";
    } else {
      $("billAmountLabel").textContent = "এখন মিটারে কত টাকা আছে (৳)";
      $("billSubmitBtn").textContent = "ব্যালেন্স যোগ করুন";
    }
  }

  function renderBills(){
    var stripEl = $("billTabsStrip");
    stripEl.innerHTML = "";
    state.bills.forEach(function(b){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "plan-tab-btn" + (b.id === state.activeBillId ? " active" : "");
      btn.textContent = b.title;
      btn.addEventListener("click", function(){
        state.activeBillId = b.id;
        save();
        renderBills();
      });
      stripEl.appendChild(btn);
    });
    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "plan-tab-add";
    addBtn.textContent = "+ নতুন";
    addBtn.addEventListener("click", createBill);
    stripEl.appendChild(addBtn);

    if(!getActiveBill() && state.bills.length) state.activeBillId = state.bills[0].id;
    var bill = getActiveBill();
    if(!bill){
      $("billEmpty").classList.remove("hidden");
      $("billPanel").classList.add("hidden");
      return;
    }
    $("billEmpty").classList.add("hidden");
    $("billPanel").classList.remove("hidden");
    $("billTitle").textContent = bill.title;
    renderBillSummary(bill);
    renderBillLog(bill);
  }

  function createBill(){
    var name = prompt("বিলের নাম লিখুন (যেমন: মিটার, গ্যাস, ইন্টারনেট)", "মিটার");
    if(name === null) return;
    name = name.trim();
    if(!name) return;
    var bill = { id: uid(), title: name, entries: [] };
    state.bills.push(bill);
    state.activeBillId = bill.id;
    save();
    renderBills();
    resetBillDateTime();
  }

  document.querySelectorAll(".bill-kind-btn").forEach(function(btn){
    btn.addEventListener("click", function(){ setBillKind(btn.dataset.kind); });
  });

  $("billDateTime").addEventListener("input", function(){ billDtTouched = true; });
  $("billNowBtn").addEventListener("click", resetBillDateTime);

  $("billEntryForm").addEventListener("submit", function(e){
    e.preventDefault();
    var bill = getActiveBill();
    if(!bill) return;
    var amount = Number($("billAmount").value);
    if(isNaN(amount) || amount < 0) return;
    if(billKind === "recharge" && amount <= 0) return;
    // if the time field was never touched, use the exact moment of saving
    var dt = (billDtTouched && $("billDateTime").value) ? $("billDateTime").value : nowLocalStr();
    bill.entries.push({ id: uid(), kind: billKind, amount: amount, dt: dt });
    save();
    $("billAmount").value = "";
    resetBillDateTime();
    renderBills();
  });

  $("billRenameBtn").addEventListener("click", function(){
    var bill = getActiveBill();
    if(!bill) return;
    var name = prompt("বিলের নাম লিখুন", bill.title);
    if(name === null) return;
    name = name.trim();
    if(!name) return;
    bill.title = name;
    save();
    renderBills();
  });

  $("billDeleteBtn").addEventListener("click", function(){
    var bill = getActiveBill();
    if(!bill) return;
    if(!confirm("এই বিলটি মুছে ফেলতে চান? এর সব এন্ট্রিও মুছে যাবে।")) return;
    state.bills = state.bills.filter(function(b){ return b.id !== bill.id; });
    state.activeBillId = state.bills.length ? state.bills[0].id : null;
    save();
    renderBills();
  });

  /* ---------------- settings: period / balance ---------------- */
  function fillSettingsForm(){
    if(!state.setup) return;
    $("set_balance").value = state.setup.initialBalance;
    $("set_start").value = state.setup.startDate;
    $("set_end").value = state.setup.endDate;
    $("topup_date").value = todayStr();
    renderTopupHistory();
  }

  $("setupEditForm").addEventListener("submit", function(e){
    e.preventDefault();
    state.setup = {
      initialBalance: Number($("set_balance").value || 0),
      startDate: $("set_start").value,
      endDate: $("set_end").value
    };
    save();
    renderDashboard();
    renderCalendarIfVisible();
    alert("আপডেট হয়ে গেছে");
  });

  $("topupForm").addEventListener("submit", function(e){
    e.preventDefault();
    var amount = Number($("topup_amount").value || 0);
    if(!amount) return;
    state.topups.push({
      id: uid(),
      amount: amount,
      date: $("topup_date").value || todayStr(),
      note: $("topup_note").value.trim()
    });
    save();
    $("topup_amount").value = "";
    $("topup_note").value = "";
    $("topup_date").value = todayStr();
    renderDashboard();
    renderTopupHistory();
  });

  function renderTopupHistory(){
    var container = $("topupHistory");
    if(state.topups.length === 0){
      container.innerHTML = '<p class="empty-state">এখনো কোনো টাকা যোগ করা হয়নি</p>';
      return;
    }
    container.innerHTML = "";
    state.topups.slice().sort(function(a,b){ return b.date.localeCompare(a.date); }).forEach(function(tu){
      var row = document.createElement("div");
      row.className = "topup-row";
      row.innerHTML =
        '<span class="tu-info">' + fmtDateHuman(tu.date) + (tu.note ? " — " + escapeHtml(tu.note) : "") + '</span>' +
        '<span class="tu-amt">' + fmtMoney(tu.amount) + '</span>' +
        '<button type="button" class="tu-del" aria-label="মুছুন">×</button>';
      row.querySelector(".tu-del").addEventListener("click", function(){
        if(!confirm("এই টাকা যোগ করাটা মুছে ফেলতে চান?")) return;
        state.topups = state.topups.filter(function(x){ return x.id !== tu.id; });
        save();
        renderDashboard();
        renderTopupHistory();
      });
      container.appendChild(row);
    });
  }

  /* ---------------- JSON backup ---------------- */
  $("exportJsonBtn").addEventListener("click", function(){
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "taka-tracker-backup-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  $("importJsonInput").addEventListener("change", function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if(!confirm("বর্তমান সব ডেটা মুছে গিয়ে এই ব্যাকআপ ফাইলের ডেটা বসে যাবে। এগোতে চান?")) return;
        state = normalizeState(parsed);
        save();
        init();
      }catch(err){
        alert("ফাইলটি ঠিকভাবে পড়া যায়নি। এটা কি সঠিক ব্যাকআপ ফাইল?");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  /* ---------------- PDF (via browser print) ---------------- */
  $("exportPdfBtn").addEventListener("click", function(){
    if(!state.setup){ alert("আগে হিসাব শুরু করুন"); return; }
    var t = getTotals(), d = getDaysInfo();
    var rows = Object.keys(state.entries).sort().map(function(dateStr){
      var e = state.entries[dateStr];
      return "<tr><td>" + fmtDateHuman(dateStr) + "</td><td>" + fmtMoney(e.amount) + "</td><td>" + (e.note ? escapeHtml(e.note) : "") + "</td></tr>";
    }).join("");
    if(!rows) rows = '<tr><td colspan="3">এখনো কোনো খরচ যোগ করা হয়নি</td></tr>';

    $("printArea").innerHTML =
      "<h1>টাকার হিসাব — রিপোর্ট</h1>" +
      '<p class="p-period">সময়কাল: ' + fmtDateHuman(state.setup.startDate) + " – " + fmtDateHuman(state.setup.endDate) + " · তৈরি হয়েছে: " + fmtDateHuman(todayStr()) + "</p>" +
      '<div class="p-summary">' +
        "<div>মোট ব্যালেন্স<strong>" + fmtMoney(t.totalBalance) + "</strong></div>" +
        "<div>মোট খরচ<strong>" + fmtMoney(t.totalSpent) + "</strong></div>" +
        "<div>বাকি আছে<strong>" + fmtMoney(t.remaining) + "</strong></div>" +
        "<div>দিন পার / বাকি<strong>" + d.daysPassed + " / " + d.daysLeft + "</strong></div>" +
      "</div>" +
      "<table><thead><tr><th>তারিখ</th><th>খরচ</th><th>নোট</th></tr></thead><tbody>" + rows + "</tbody></table>";

    window.print();
  });

  /* ---------------- reset ---------------- */
  $("resetAllBtn").addEventListener("click", function(){
    if(!confirm("সত্যিই সব ডেটা মুছে ফেলতে চান? এটা আর ফেরানো যাবে না।")) return;
    if(!confirm("একদম শেষবার জিজ্ঞেস করছি — সব মুছে ফেলি?")) return;
    state = defaultState();
    save();
    init();
  });

  /* ---------------- onboarding ---------------- */
  $("onboardingForm").addEventListener("submit", function(e){
    e.preventDefault();
    state = defaultState();
    state.setup = {
      initialBalance: Number($("ob_balance").value || 0),
      startDate: $("ob_start").value,
      endDate: $("ob_end").value
    };
    save();
    init();
  });

  /* ---------------- Supabase: auth + cloud sync ---------------- */
  var TABLE = "user_data";
  var sb = null;
  var currentUser = null;
  var loadedFor = null;
  var recoveryMode = false;

  var saveTimer = null, retryTimer = null;
  var saving = false, pending = false, savePromise = null;
  var lastSyncedMs = 0;

  function cfg(){ return window.APP_CONFIG || {}; }
  function configOk(){
    var c = cfg();
    return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY &&
      !/YOUR_/i.test(c.SUPABASE_URL) && !/YOUR_/i.test(c.SUPABASE_ANON_KEY) &&
      window.supabase && window.supabase.createClient);
  }
  function redirectUrl(){ return location.origin + location.pathname; }
  function cleanHash(){
    if(location.hash){
      try{ history.replaceState(null, "", location.pathname + location.search); }catch(e){}
    }
  }

  /* ----- screens ----- */
  function showScreen(name){
    $("authLoading").classList.toggle("hidden", name !== "loading");
    $("authScreen").classList.toggle("hidden", name !== "auth");
    if(name !== "app"){
      onboarding.classList.add("hidden");
      mainApp.classList.add("hidden");
    }
  }
  var AUTH_FORMS = { login:"loginForm", signup:"signupForm", forgot:"forgotForm", reset:"resetForm", loaderror:"loadError" };
  function showAuthForm(name, keepMsg){
    Object.keys(AUTH_FORMS).forEach(function(k){
      $(AUTH_FORMS[k]).classList.toggle("hidden", k !== name);
    });
    if(!keepMsg) showAuthMsg("");
  }
  function showAuthMsg(text, kind){
    var el = $("authMsg");
    if(!text){ el.classList.add("hidden"); el.textContent = ""; return; }
    el.textContent = text;
    el.className = "auth-msg " + (kind || "error");
  }
  function authErrText(err){
    var m = (err && err.message) || "", code = (err && err.code) || "";
    if(code === "invalid_credentials" || /invalid login credentials/i.test(m)) return "ইমেইল বা পাসওয়ার্ড ঠিক নেই।";
    if(code === "email_not_confirmed" || /email not confirmed/i.test(m)) return "আগে ইমেইল যাচাই করুন — ইনবক্সে পাঠানো লিংকে ক্লিক করুন।";
    if(code === "user_already_exists" || /already registered/i.test(m)) return "এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে। লগইন করুন।";
    if(code === "weak_password" || /password should be/i.test(m)) return "পাসওয়ার্ড আরও শক্ত করুন (কমপক্ষে ৮ অক্ষর)।";
    if(code === "same_password" || /different from the old/i.test(m)) return "নতুন পাসওয়ার্ড আগেরটার থেকে আলাদা হতে হবে।";
    if(code === "over_email_send_rate_limit" || err.status === 429 || /rate limit|too many/i.test(m)) return "অল্প সময়ে অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।";
    if(/session missing|not authenticated/i.test(m)) return "রিসেট লিংকের মেয়াদ শেষ হয়ে গেছে। \"পাসওয়ার্ড ভুলে গেছেন?\" থেকে নতুন লিংক নিন।";
    if(/failed to fetch|network/i.test(m)) return "ইন্টারনেট সংযোগ পরীক্ষা করুন।";
    return "কিছু একটা সমস্যা হয়েছে: " + m;
  }
  function busy(form, on){
    var b = form.querySelector('button[type=submit]');
    if(b) b.disabled = on;
  }

  /* ----- sync status pill ----- */
  function setSyncStatus(kind){
    var el = $("syncStatus");
    if(!el) return;
    var map = { saving:"সেভ হচ্ছে…", saved:"✓ অনলাইনে সেভ হয়েছে", error:"⚠ সেভ হয়নি — আবার চেষ্টা করছি" };
    el.textContent = map[kind] || "";
    el.classList.toggle("err", kind === "error");
  }

  /* ----- saving (debounced upsert of the whole state as one JSON row) ----- */
  function save(){
    if(!currentUser || !state) return;
    pending = true;
    setSyncStatus("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushNow, 500);
  }

  function pushNow(){
    clearTimeout(saveTimer); saveTimer = null;
    clearTimeout(retryTimer); retryTimer = null;
    if(!currentUser || !state || !pending) return Promise.resolve(true);
    if(saving) return savePromise;
    saving = true; pending = false;
    var uid = currentUser.id, ts = new Date().toISOString();

    function fail(){
      saving = false; pending = true;
      setSyncStatus("error");
      retryTimer = setTimeout(pushNow, 8000);
      return false;
    }
    savePromise = sb.from(TABLE).upsert({ user_id: uid, data: state, updated_at: ts }).then(function(res){
      if(res.error){ console.error(res.error); return fail(); }
      saving = false;
      lastSyncedMs = Date.parse(ts);
      if(pending) return pushNow();
      setSyncStatus("saved");
      return true;
    }, function(err){ console.error(err); return fail(); });
    return savePromise;
  }

  /* ----- loading ----- */
  function normalizeState(p){
    p = p || {};
    return {
      setup: p.setup || null,
      topups: p.topups || [],
      entries: p.entries || {},
      quickNotes: p.quickNotes || {},
      plans: p.plans || [],
      activePlanId: p.activePlanId || null,
      bills: p.bills || [],
      activeBillId: p.activeBillId || null
    };
  }

  function loadLegacy(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      var s = normalizeState(JSON.parse(raw));
      return s.setup ? s : null;
    }catch(e){ return null; }
  }

  async function startForUser(user){
    currentUser = user;
    loadedFor = user.id;
    showScreen("loading");
    try{
      var res = await sb.from(TABLE).select("data,updated_at").eq("user_id", user.id).maybeSingle();
      if(res.error) throw res.error;

      if(res.data){
        state = normalizeState(res.data.data);
        lastSyncedMs = Date.parse(res.data.updated_at);
      } else {
        state = defaultState();
        lastSyncedMs = 0;
        // first login on this account: offer to bring over the old browser-only data
        var legacy = loadLegacy();
        if(legacy && confirm("এই ব্রাউজারে আগের হিসাবের ডেটা পাওয়া গেছে। এটা এই অ্যাকাউন্টে নিয়ে আসবেন?")){
          state = legacy;
          pending = true;
          var ok = await pushNow();
          if(ok) localStorage.removeItem(STORAGE_KEY);
        }
      }
    }catch(err){
      console.error(err);
      loadedFor = null;
      var msg = (err && err.message) || "";
      if(/user_data/.test(msg) && /(find|exist|relation)/i.test(msg)){
        msg = "ডেটাবেসে user_data টেবিল পাওয়া যায়নি। supabase-setup.sql ফাইলটি Supabase-এর SQL Editor-এ চালান।";
      }
      $("loadErrorText").textContent = msg || "ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।";
      showScreen("auth");
      showAuthForm("loaderror");
      return;
    }
    $("accountEmail").textContent = user.email || "";
    setSyncStatus("");
    cleanHash();
    init();
  }

  function handleSignedOut(){
    clearTimeout(saveTimer); clearTimeout(retryTimer);
    currentUser = null; loadedFor = null; state = null;
    pending = false; saving = false; recoveryMode = false;
    setSyncStatus("");
    ["login_password","signup_password","signup_password2","reset_password","reset_password2"].forEach(function(id){ $(id).value = ""; });
    showScreen("auth");
    showAuthForm("login");
  }

  function handleAuthEvent(event, session){
    if(event === "PASSWORD_RECOVERY"){
      recoveryMode = true;
      showScreen("auth");
      showAuthForm("reset");
      return;
    }
    if(event === "SIGNED_OUT"){ handleSignedOut(); return; }
    if(session && session.user){
      if(recoveryMode) return;
      if(loadedFor === session.user.id){ currentUser = session.user; return; }
      startForUser(session.user);
      return;
    }
    if(event === "INITIAL_SESSION" && !recoveryMode){
      showScreen("auth");
      showAuthForm("login", true);   // keep any message (e.g. expired-link notice)
    }
  }

  /* ----- pick up changes made on another device ----- */
  function applyRemoteState(){
    if(!state.setup){ init(); return; }
    entryDateInput.min = state.setup.startDate;
    entryDateInput.max = state.setup.endDate;
    renderDashboard();
    var cur = "add";
    tabs.forEach(function(t){ if(!$("tab-"+t).classList.contains("hidden")) cur = t; });
    if(cur === "add") loadEntryForDate(entryDateInput.value || todayStr());
    else switchTab(cur);
  }
  async function refreshFromRemote(){
    if(!currentUser || !state || pending || saving || recoveryMode) return;
    try{
      var res = await sb.from(TABLE).select("data,updated_at").eq("user_id", currentUser.id).maybeSingle();
      if(res.error || !res.data) return;
      var ms = Date.parse(res.data.updated_at);
      if(ms === lastSyncedMs || pending || saving) return;
      state = normalizeState(res.data.data);
      lastSyncedMs = ms;
      applyRemoteState();
    }catch(e){ /* ignore, will retry next time */ }
  }
  document.addEventListener("visibilitychange", function(){
    if(!sb) return;
    if(document.visibilityState === "hidden"){ if(pending) pushNow(); }
    else refreshFromRemote();
  });
  window.addEventListener("beforeunload", function(e){
    if(pending || saving){ e.preventDefault(); e.returnValue = ""; }
  });

  /* ----- auth form handlers ----- */
  document.querySelectorAll(".link-btn[data-go]").forEach(function(btn){
    btn.addEventListener("click", function(){ showAuthForm(btn.dataset.go); });
  });
  document.querySelectorAll(".pw-toggle").forEach(function(btn){
    btn.addEventListener("click", function(){
      var input = $(btn.dataset.target);
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "লুকান" : "দেখান";
    });
  });

  $("loginForm").addEventListener("submit", async function(e){
    e.preventDefault();
    var form = e.target;
    showAuthMsg("");
    busy(form, true);
    try{
      var r = await sb.auth.signInWithPassword({
        email: $("login_email").value.trim(),
        password: $("login_password").value
      });
      if(r.error) showAuthMsg(authErrText(r.error));
      // on success onAuthStateChange takes over
    }catch(err){ showAuthMsg(authErrText(err)); }
    busy(form, false);
  });

  $("signupForm").addEventListener("submit", async function(e){
    e.preventDefault();
    var form = e.target;
    showAuthMsg("");
    var pw = $("signup_password").value;
    if(pw.length < 8){ showAuthMsg("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।"); return; }
    if(pw !== $("signup_password2").value){ showAuthMsg("দুটি পাসওয়ার্ড মিলছে না।"); return; }
    busy(form, true);
    try{
      var email = $("signup_email").value.trim();
      var r = await sb.auth.signUp({ email: email, password: pw, options: { emailRedirectTo: redirectUrl() } });
      if(r.error){
        showAuthMsg(authErrText(r.error));
      } else if(r.data && r.data.session){
        // email confirmation is switched off in Supabase: already signed in
      } else if(r.data && r.data.user && r.data.user.identities && r.data.user.identities.length === 0){
        showAuthMsg("এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে। লগইন করুন, অথবা পাসওয়ার্ড ভুলে গেলে রিসেট করুন।");
      } else {
        $("login_email").value = email;
        showAuthForm("login");
        showAuthMsg("আপনার ইমেইলে একটি যাচাইকরণ লিংক পাঠানো হয়েছে। লিংকে ক্লিক করার পর এখানে লগইন করুন। (স্প্যাম ফোল্ডারও দেখে নিন)", "ok");
      }
    }catch(err){ showAuthMsg(authErrText(err)); }
    busy(form, false);
  });

  $("forgotForm").addEventListener("submit", async function(e){
    e.preventDefault();
    var form = e.target;
    showAuthMsg("");
    busy(form, true);
    try{
      var r = await sb.auth.resetPasswordForEmail($("forgot_email").value.trim(), { redirectTo: redirectUrl() });
      if(r.error) showAuthMsg(authErrText(r.error));
      else showAuthMsg("ওই ইমেইলে অ্যাকাউন্ট থাকলে পাসওয়ার্ড রিসেটের লিংক পাঠানো হয়েছে। ইনবক্স (আর স্প্যাম) দেখুন।", "ok");
    }catch(err){ showAuthMsg(authErrText(err)); }
    busy(form, false);
  });

  $("resetForm").addEventListener("submit", async function(e){
    e.preventDefault();
    var form = e.target;
    showAuthMsg("");
    var pw = $("reset_password").value;
    if(pw.length < 8){ showAuthMsg("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।"); return; }
    if(pw !== $("reset_password2").value){ showAuthMsg("দুটি পাসওয়ার্ড মিলছে না।"); return; }
    busy(form, true);
    try{
      var r = await sb.auth.updateUser({ password: pw });
      if(r.error){
        showAuthMsg(authErrText(r.error));
      } else {
        recoveryMode = false;
        $("reset_password").value = ""; $("reset_password2").value = "";
        var s = await sb.auth.getSession();
        if(s.data && s.data.session) startForUser(s.data.session.user);
        else { showAuthForm("login"); showAuthMsg("পাসওয়ার্ড বদলানো হয়েছে। এখন লগইন করুন।", "ok"); }
      }
    }catch(err){ showAuthMsg(authErrText(err)); }
    busy(form, false);
  });

  $("loadRetryBtn").addEventListener("click", async function(){
    var s = await sb.auth.getSession();
    if(s.data && s.data.session) startForUser(s.data.session.user);
    else handleSignedOut();
  });
  $("loadLogoutBtn").addEventListener("click", function(){ sb.auth.signOut(); });

  $("logoutBtn").addEventListener("click", async function(){
    if(pending || saving){
      var ok = await pushNow();
      if(!ok && !confirm("কিছু পরিবর্তন সেভ হয়নি। তবুও লগ আউট করবেন?")) return;
    }
    sb.auth.signOut();
  });

  /* ----- boot ----- */
  function boot(){
    showScreen("loading");
    if(!configOk()){
      showScreen("auth");
      Object.keys(AUTH_FORMS).forEach(function(k){ $(AUTH_FORMS[k]).classList.add("hidden"); });
      $("authConfigWarn").classList.remove("hidden");
      return;
    }
    var c = cfg();
    sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    // links from emails come back with the result in the URL hash
    var hash = location.hash.replace(/^#/, "");
    var hp = new URLSearchParams(hash);
    recoveryMode = hp.get("type") === "recovery";
    if(hp.get("error") || hp.get("error_description")){
      cleanHash();
      showScreen("auth");
      showAuthForm("login");
      showAuthMsg("লিংকটি কাজ করছে না বা এর মেয়াদ শেষ হয়ে গেছে। আবার চেষ্টা করুন।");
    }
    if(recoveryMode){
      showScreen("auth");
      showAuthForm("reset");
    }

    // (run handler outside the callback: supabase-js advises against awaiting its own calls inside it)
    sb.auth.onAuthStateChange(function(event, session){
      setTimeout(function(){ handleAuthEvent(event, session); }, 0);
    });
  }

  /* ---------------- init ---------------- */
  function init(){
    if(!state) state = defaultState();
    $("authLoading").classList.add("hidden");
    $("authScreen").classList.add("hidden");
    if(!state.setup){
      onboarding.classList.remove("hidden");
      mainApp.classList.add("hidden");
      var t = todayStr();
      $("ob_start").value = t;
      var endDefault = new Date();
      endDefault.setDate(endDefault.getDate() + 29);
      $("ob_end").value = fmtISO(endDefault);
      return;
    }
    onboarding.classList.add("hidden");
    mainApp.classList.remove("hidden");

    var initialDate = clampDate(todayStr(), state.setup.startDate, state.setup.endDate);
    entryDateInput.value = initialDate;
    entryDateInput.min = state.setup.startDate;
    entryDateInput.max = state.setup.endDate;
    loadEntryForDate(initialDate);

    calViewDate = parseISO(initialDate);

    renderDashboard();
    switchTab("add");
  }

  boot();
})();
