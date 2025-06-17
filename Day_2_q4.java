package Hutech;

import java.util.Scanner;

public class Day_2_q4 {
    //Write a Program to Find Factorial of a Number in Java
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println("Enter a number ");
        int n= sc.nextInt();
        int res = factorial(n);
        System.out.println("the factoiral of "+n +" was "+ res);
    }

    private static int factorial(int n) {
        int re= 1;
        for(int i=1;i<=n;i++){
            re=re*i;
        }
        return re;
    }
    
}
