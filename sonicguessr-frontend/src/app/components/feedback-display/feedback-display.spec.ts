import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FeedbackDisplay } from './feedback-display';

describe('FeedbackDisplay', () => {
  let component: FeedbackDisplay;
  let fixture: ComponentFixture<FeedbackDisplay>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeedbackDisplay]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FeedbackDisplay);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
