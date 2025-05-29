import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DailyChallenge } from './daily-challenge';

describe('DailyChallenge', () => {
  let component: DailyChallenge;
  let fixture: ComponentFixture<DailyChallenge>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DailyChallenge]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DailyChallenge);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
