import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GuessInput } from './guess-input';

describe('GuessInput', () => {
  let component: GuessInput;
  let fixture: ComponentFixture<GuessInput>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GuessInput]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GuessInput);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
