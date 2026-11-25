import test from "node:test";
import assert from "node:assert/strict";
import { localTimeMinutes, zonedMidnightUtc, onDay } from "../tablet-board/view-helpers.mjs";
import { provisionalToday, refreshPhoneProjection } from "../phone/local-projection.mjs";
import { shiftDay, todayKey } from "../phone/view-model.mjs";
const pacific = "America/Los_Angeles";
const timed = (starts_at, ends_at) => ({time_kind:"timed", starts_at, ends_at});

test("Pacific DST day boundaries and repeated hours preserve absolute instants", () => {
  for (const [date, hours] of [["2026-03-08",23],["2026-11-01",25]]) {
    const first = Date.parse(zonedMidnightUtc(date,pacific));
    const end = Date.parse(zonedMidnightUtc(shiftDay(date,1),pacific));
    assert.equal(end-first, hours * 3600000);
    const overnight = timed(new Date(first-1).toISOString(),new Date(end).toISOString());
    assert.ok(onDay(overnight,shiftDay(date,-1),pacific));
    assert.ok(onDay(overnight,date,pacific));
    assert.ok(!onDay(overnight,shiftDay(date,1),pacific));
  }
  for (const instant of ["2026-11-01T08:30:00Z","2026-11-01T09:30:00Z"]) {
    assert.equal(localTimeMinutes(new Date(instant),pacific),90);
  }
});

test("crossing the date line in either direction rebuilds day groups from saved intervals only", () => {
  const now = new Date("2026-06-01T10:15Z");
  const cache = {timezone:"Australia/Darwin", windowStart:"2026-05-31",windowEnd:"2026-06-09",events:[
    timed(now.toISOString(),"2026-06-01T11:15Z"),
    {time_kind:"all_day",start_date:"2026-06-01",end_date:"2026-06-02"},
  ],today:{tasks:[{title:"Old selection"}]}};
  for (const [zone,date] of [["Pacific/Honolulu","2026-06-01"],["Pacific/Kiritimati","2026-06-02"],["Pacific/Honolulu","2026-06-01"]]) {
    const view = provisionalToday(cache,zone,now);
    assert.equal(view.metadata.today,date);
    assert.equal(view.days[0].events[0].start,"00:15");
    assert.equal(view.days[0].allDay.length,Number(date==="2026-06-01"));
    assert.deepEqual(view.tasks,[]);
    assert.ok(view.provisional);
  }
  assert.equal(cache.timezone,"Australia/Darwin");
  assert.equal(todayKey(now,"Australia/Darwin"),"2026-06-01");
});

test("a superseded refresh cannot replace the new zone's persisted selection", async () => {
  let release, active = "Australia/Darwin";
  const day = "2026-06-01";
  const gate = new Promise(resolve => { release = resolve; });
  const writes = [];
  const refresh = timezone => refreshPhoneProjection({timezone, day, current: () => timezone === active,
    store:{write: async p => writes.push(p.timezone)}, services:{
      async getPhoneTodaySnapshot(zone) {
        if(zone !== pacific) await gate;
        return {timezone:zone,metadata:{today:day},days:[],tasks:[]};
      },listTaskView:async()=>[],listWeekEvents:async()=>[],listCategories:async()=>[],listTags:async()=>[],
    }});
  const old = refresh(active);
  active = pacific;
  assert.equal((await refresh(active)).timezone,pacific);
  release();
  assert.equal(await old,null);
  assert.deepEqual(writes,[pacific]);
});
